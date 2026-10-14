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

-- Ohne Anmeldung sieht man nichts – und bekommt keinen Fehler, obwohl die Policies eine
-- Funktion aufrufen, die `anon` nicht ausführen darf.
insert into auth.users (id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.vaults (id, owner_id, keyring)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{}'::jsonb);

do $$
declare
  anzahl integer;
begin
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into anzahl from public.vaults;
  assert anzahl = 0, 'anon darf keine Vaults sehen';
  select count(*) into anzahl from public.records;
  assert anzahl = 0, 'anon darf keine Records sehen';
  reset role;
  raise notice 'anon: Vaults und Records leer, kein Fehler - bestanden';
end;
$$;
