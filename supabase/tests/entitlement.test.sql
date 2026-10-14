-- Prüft die Berechtigungslogik (`private.has_active_sync`, Policies) gegen echtes Postgres.
--
-- Warum nicht in JavaScript nachgebaut: ein Nachbau könnte grün bleiben, während die
-- Migration falsch ist. Getestet wird deshalb die Funktion selbst.
--
-- Lokal ausführen:  ./supabase/tests/run.sh
-- Gegen ein echtes Projekt: die Abschnitte "Vorbereitung"/"Aufräumen" weglassen und
-- mit zwei echten Konten arbeiten.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Vorbereitung: zwei Konten
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

do $$
declare
  zahlend  uuid := '11111111-1111-4111-8111-111111111111';
  gratis   uuid := '22222222-2222-4222-8222-222222222222';
  zukunft  timestamptz := now() + interval '30 days';
  vergangen timestamptz := now() - interval '1 day';
begin
  -- ohne alles
  assert not private.has_active_sync(gratis), 'Ohne Abo darf nicht synchronisiert werden';

  -- aktives Abo
  insert into public.subscriptions (user_id, provider_sub_id, status, current_period_end)
  values (zahlend, 'sub_1', 'active', zukunft);
  assert private.has_active_sync(zahlend), 'Aktives Abo muss berechtigen';

  -- Zahlungsverzug: eine abgelaufene Karte soll nicht sofort den Sync kappen
  update public.subscriptions set status = 'past_due' where user_id = zahlend;
  assert private.has_active_sync(zahlend), 'past_due muss weiterhin berechtigen';

  -- gekündigt, aber bezahlte Zeit läuft noch
  update public.subscriptions set status = 'canceled' where user_id = zahlend;
  assert private.has_active_sync(zahlend),
    'Gekuendigt mit Restlaufzeit muss berechtigen - sonst verliert der Kunde bezahlte Zeit';

  -- Periode abgelaufen
  update public.subscriptions set current_period_end = vergangen where user_id = zahlend;
  assert not private.has_active_sync(zahlend), 'Nach Periodenende muss gesperrt werden';

  -- aktiv, aber Periode abgelaufen: das Datum entscheidet, nicht der Status
  update public.subscriptions set status = 'active' where user_id = zahlend;
  assert not private.has_active_sync(zahlend), 'Abgelaufene Periode schlaegt den Status';

  -- pausiert
  update public.subscriptions
     set status = 'paused', current_period_end = zukunft where user_id = zahlend;
  assert not private.has_active_sync(zahlend), 'Pausiertes Abo darf nicht berechtigen';

  -- manuelle Freischaltung wirkt ohne jedes Abo
  update public.profiles set plan = 'premium' where id = gratis;
  assert private.has_active_sync(gratis), 'Manuelle Freischaltung muss wirken';
  update public.profiles set plan = 'free' where id = gratis;
  assert not private.has_active_sync(gratis), 'Zuruecknahme der Freischaltung muss wirken';

  raise notice 'has_active_sync: alle Faelle bestanden';
end $$;

-- ---------------------------------------------------------------------------
-- Erst bezahlen, dann anmelden: Abo ohne Konto, zugeordnet über die E-Mail
-- ---------------------------------------------------------------------------
do $$
declare
  kaeufer uuid := '22222222-2222-4222-8222-222222222222';
  anderer uuid := '11111111-1111-4111-8111-111111111111';
  zukunft timestamptz := now() + interval '30 days';
begin
  update auth.users set email = 'Kaeufer@Example.org', email_confirmed_at = now() where id = kaeufer;
  update auth.users set email = 'anderer@example.org', email_confirmed_at = now() where id = anderer;
  delete from public.subscriptions;
  update public.profiles set plan = 'free';

  insert into public.subscriptions (user_id, email, provider_sub_id, status, current_period_end)
  values (null, 'kaeufer@example.org', 'sub_ohne_konto', 'active', zukunft);

  assert private.has_active_sync(kaeufer),
    'Abo ohne Konto muss fuer das Konto mit derselben E-Mail gelten (Gross-/Kleinschreibung egal)';
  assert not private.has_active_sync(anderer), 'Abo darf nicht fuer eine fremde E-Mail gelten';

  -- Unbestätigte Adresse: ein Passwort-Konto auf die Adresse des Käufers, ohne Nachweis,
  -- darf das Abo nicht übernehmen.
  update auth.users set email_confirmed_at = null where id = kaeufer;
  assert not private.has_active_sync(kaeufer), 'Abo ohne Konto darf nur fuer eine bestaetigte E-Mail gelten';
  update auth.users set email_confirmed_at = now() where id = kaeufer;

  -- Ein bereits zugeordnetes Abo wandert nicht mit der E-Mail-Adresse.
  update public.subscriptions set user_id = anderer where provider_sub_id = 'sub_ohne_konto';
  assert not private.has_active_sync(kaeufer), 'Zugeordnetes Abo darf nur fuer sein Konto gelten';
  assert private.has_active_sync(anderer), 'Zugeordnetes Abo muss fuer sein Konto gelten';

  -- Abgelaufen ist abgelaufen, auch ohne Konto.
  update public.subscriptions
     set user_id = null, current_period_end = now() - interval '1 day'
   where provider_sub_id = 'sub_ohne_konto';
  assert not private.has_active_sync(kaeufer), 'Abgelaufenes Abo ohne Konto darf nicht berechtigen';

  -- Konto ohne E-Mail (z. B. Telefon-Login) darf nicht auf ein E-Mail-Abo passen.
  update auth.users set email = null where id = kaeufer;
  update public.subscriptions set current_period_end = zukunft where provider_sub_id = 'sub_ohne_konto';
  assert not private.has_active_sync(kaeufer), 'Konto ohne E-Mail darf nicht berechtigt sein';

  delete from public.subscriptions;
  raise notice 'Abo ohne Konto: alle Faelle bestanden';
end $$;

-- ---------------------------------------------------------------------------
-- Policies: Lesen bleibt, Schreiben haengt an der Berechtigung
-- ---------------------------------------------------------------------------
do $$
declare
  zahlend uuid := '11111111-1111-4111-8111-111111111111';
  vault   uuid := '33333333-3333-4333-8333-333333333333';
  gelesen int;
begin
  insert into public.vaults (id, owner_id, keyring) values (vault, zahlend, '{}'::jsonb);
  insert into public.vault_members (vault_id, user_id) values (vault, zahlend);
  insert into public.records (id, vault_id, hlc, iv, ct, key_version)
  values ('44444444-4444-4444-8444-444444444444', vault, '000000000000001:0000:aaaa', 'iv', 'ct', 1);

  -- Kein Abo: Lesen muss trotzdem gehen. Vorbereitung als Admin – als Nutzer liefe sie
  -- ins Leere (Abos) bzw. scheiterte (Profil).
  delete from public.subscriptions where user_id = zahlend;
  update public.profiles set plan = 'free' where id = zahlend;

  -- Als dieser Nutzer auftreten und RLS erzwingen.
  perform set_config('request.jwt.claims', json_build_object('sub', zahlend)::text, true);
  set local role authenticated;
  select count(*) into gelesen from public.records;
  assert gelesen = 1, 'Ohne Abo muss Lesen weiterhin moeglich sein';

  -- Kein Abo: Schreiben muss scheitern.
  begin
    insert into public.records (id, vault_id, hlc, iv, ct, key_version)
    values ('55555555-5555-4555-8555-555555555555', vault, '000000000000002:0000:aaaa', 'iv', 'ct', 1);
    reset role;
    raise exception 'Schreiben ohne Abo haette scheitern muessen';
  exception
    when insufficient_privilege then
      null; -- erwartet
  end;
  reset role;

  raise notice 'Policies: Lesen erlaubt, Schreiben gesperrt - bestanden';
end $$;

-- ---------------------------------------------------------------------------
-- push_records liefert einen unterscheidbaren Fehler
-- ---------------------------------------------------------------------------
do $$
declare
  zahlend uuid := '11111111-1111-4111-8111-111111111111';
  vault   uuid := '33333333-3333-4333-8333-333333333333';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', zahlend)::text, true);
  set local role authenticated;
  begin
    perform public.push_records(vault, '[]'::jsonb);
    reset role;
    raise exception 'push_records haette TP001 werfen muessen';
  exception
    when sqlstate 'TP001' then
      null; -- erwartet: der Client kann daran die Kaufaufforderung festmachen
  end;
  reset role;

  raise notice 'push_records: TP001 ohne Abo - bestanden';
end $$;

-- ---------------------------------------------------------------------------
-- push_records schreibt mit Abo tatsaechlich – neu und als Update
-- ---------------------------------------------------------------------------
do $$
declare
  zahlend uuid := '11111111-1111-4111-8111-111111111111';
  vault   uuid := '33333333-3333-4333-8333-333333333333';
  rec     uuid := '66666666-6666-4666-8666-666666666666';
  n       int;
begin
  insert into public.subscriptions (user_id, provider_sub_id, status, current_period_end)
  values (zahlend, 'sub_push', 'active', now() + interval '30 days');

  perform set_config('request.jwt.claims', json_build_object('sub', zahlend)::text, true);
  set local role authenticated;

  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv', 'ct', 'ct1', 'keyVersion', 1)));
  assert n = 1, 'Neuer Record muss geschrieben und zurueckgemeldet werden';
  -- Ohne Sperre bis zum Commit koennten gleichzeitige Pushes Pull-Cursor ueberspringen lassen.
  assert exists (
    select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
  ), 'push_records muss den Vault bis zum Commit sperren';

  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000020:0000:aaaa', 'iv', 'iv', 'ct', 'ct2', 'keyVersion', 1)));
  assert n = 1, 'Neuere Version muss den Record aktualisieren';

  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000015:0000:aaaa', 'iv', 'iv', 'ct', 'alt', 'keyVersion', 1)));
  assert n = 0, 'Aeltere Version darf nichts ueberschreiben';
  reset role;

  assert (select ct from public.records where id = rec) = 'ct2', 'Stand muss der neueste sein';

  delete from public.subscriptions where provider_sub_id = 'sub_push';
  raise notice 'push_records: Schreiben mit Abo - bestanden';
end $$;

-- ---------------------------------------------------------------------------
-- Aufräumen
-- ---------------------------------------------------------------------------
delete from public.records where vault_id = '33333333-3333-4333-8333-333333333333';
delete from public.vault_members where vault_id = '33333333-3333-4333-8333-333333333333';
delete from public.vaults where id = '33333333-3333-4333-8333-333333333333';
delete from auth.users where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
