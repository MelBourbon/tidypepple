-- Prüft, wer die `security definer`-Funktionen aufrufen darf und was dafür im
-- Schema `private` liegt.

\set ON_ERROR_STOP on

-- Über die REST-API erreichbar, aber nur für Angemeldete.
do $$
begin
  assert not has_function_privilege('anon', 'public.ensure_vault(uuid, jsonb)', 'execute'),
    'anon darf ensure_vault nicht ausfuehren';
  assert has_function_privilege('authenticated', 'public.ensure_vault(uuid, jsonb)', 'execute'),
    'authenticated muss ensure_vault ausfuehren duerfen';
  raise notice 'ensure_vault: nur fuer Angemeldete - bestanden';
end;
$$;

-- Nicht mehr über die REST-API erreichbar, für Policies und RPCs aber weiter aufrufbar.
do $$
declare
  fn text;
begin
  foreach fn in array array['vault_attachment_bytes(uuid)', 'is_vault_member(uuid)', 'has_active_sync(uuid)'] loop
    assert to_regprocedure('public.' || fn) is null, format('%s darf nicht mehr in public liegen', fn);
    assert has_function_privilege('authenticated', 'private.' || fn, 'execute'),
      format('authenticated muss %s ausfuehren duerfen', fn);
    assert not has_function_privilege('anon', 'private.' || fn, 'execute'),
      format('anon darf %s nicht ausfuehren', fn);
  end loop;
  assert not has_schema_privilege('anon', 'private', 'usage'), 'anon darf das Schema private nicht nutzen';
  raise notice 'vault_attachment_bytes, is_vault_member, has_active_sync: im Schema private - bestanden';
end;
$$;

-- Ohne Anmeldung sieht man nichts. In einem bestehenden Projekt hat `anon` noch Rechte auf
-- die Tabellen: Dann bleibt die Abfrage leer und ohne Fehler, obwohl die Policies eine
-- Funktion aufrufen, die `anon` nicht ausführen darf. In einem neuen Projekt fehlt das
-- Recht, dann wird sie abgewiesen.
insert into auth.users (id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.vaults (id, owner_id, keyring)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{}'::jsonb);

do $$
declare
  t      text;
  anzahl integer;
begin
  perform set_config('request.jwt.claims', '{}', true);
  foreach t in array array['public.vaults', 'public.records'] loop
    if has_table_privilege('anon', t, 'select') then
      set local role anon;
      execute format('select count(*) from %s', t) into anzahl;
      reset role;
      assert anzahl = 0, format('anon darf in %s nichts sehen', t);
    else
      begin
        set local role anon;
        execute format('select count(*) from %s', t) into anzahl;
        reset role;
        raise exception 'anon haette % nicht lesen duerfen', t;
      exception
        when insufficient_privilege then null;
      end;
      reset role;
    end if;
  end loop;
  raise notice 'anon: Vaults und Records leer oder gesperrt - bestanden';
end;
$$;

-- Was Geräte brauchen, steht ausdrücklich in den Migrationen und hängt nicht an den
-- Default-Privilegien des Projekts.
do $$
declare
  t text;
begin
  foreach t in array array['public.profiles', 'public.vaults', 'public.vault_members', 'public.records', 'public.subscriptions'] loop
    assert has_table_privilege('authenticated', t, 'select'), format('authenticated muss %s lesen duerfen', t);
  end loop;
  assert has_table_privilege('authenticated', 'public.records', 'insert'), 'authenticated muss Records einfuegen duerfen';
  assert has_table_privilege('authenticated', 'public.records', 'update'), 'authenticated muss Records aendern duerfen';
  assert has_sequence_privilege('authenticated', 'public.records_seq', 'usage'), 'authenticated muss records_seq nutzen duerfen';
  raise notice 'authenticated: Tabellenrechte ausdruecklich vergeben - bestanden';
end;
$$;
