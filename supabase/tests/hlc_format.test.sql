-- Prüft, dass der Server nur gültig geformte HLC-Zeitstempel annimmt (0004_hlc_format.sql).
--
-- Ein Wert wie 'zzz' gewänne den Vergleich in `write_records` gegen jeden echten Stempel und
-- fröre den Record ein: Spätere Änderungen verwürfe der Server, während die Geräte sie für
-- hochgeladen hielten.

\set ON_ERROR_STOP on

insert into auth.users (id, email, email_confirmed_at)
values ('a4000000-0000-4000-8000-000000000001', 'hlc@example.com', now());

do $$
declare
  nutzer uuid := 'a4000000-0000-4000-8000-000000000001';
  vault  uuid := 'a4000000-0000-4000-8000-000000000002';
  rec    uuid := 'a4000000-0000-4000-8000-000000000003';
  kaputt text;
  n      int;
begin
  insert into public.vaults (id, owner_id, keyring) values (vault, nutzer, '{}'::jsonb);
  insert into public.vault_members (vault_id, user_id) values (vault, nutzer);
  insert into public.subscriptions (user_id, provider_sub_id, status, current_period_end)
  values (nutzer, 'sub_hlc', 'active', now() + interval '30 days');

  perform set_config('request.jwt.claims', json_build_object('sub', nutzer)::text, true);
  set local role authenticated;

  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv', 'ct', 'ct1', 'keyVersion', 1)));
  assert n = 1, 'Ein gueltiger Zeitstempel muss angenommen werden';

  -- Groesser als jeder echte Stempel, zu kurz, Zaehler nicht hexadezimal, ohne Geraete-ID.
  foreach kaputt in array array['zzz', '10:0000:aaaa', '000000000000020:zzzz:aaaa', '000000000000020:0000:'] loop
    begin
      perform public.push_records(vault, jsonb_build_array(jsonb_build_object(
        'id', rec, 'hlc', kaputt, 'iv', 'iv', 'ct', 'boese', 'keyVersion', 1)));
      raise exception 'Zeitstempel % haette abgelehnt werden muessen', kaputt;
    exception
      when check_violation then
        null; -- erwartet
    end;
  end loop;

  -- Der Record ist nicht eingefroren: eine echte, neuere Aenderung kommt weiterhin an.
  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000020:0000:aaaa', 'iv', 'iv', 'ct', 'ct2', 'keyVersion', 1)));
  assert n = 1, 'Nach einem abgelehnten Zeitstempel muss der Record aenderbar bleiben';
  reset role;

  assert (select ct from public.records where id = rec) = 'ct2', 'Stand muss der neueste gueltige sein';
  raise notice 'HLC-Format: nur gueltige Zeitstempel - bestanden';
end $$;

delete from public.records where vault_id = 'a4000000-0000-4000-8000-000000000002';
delete from public.subscriptions where provider_sub_id = 'sub_hlc';
delete from public.vault_members where vault_id = 'a4000000-0000-4000-8000-000000000002';
delete from public.vaults where id = 'a4000000-0000-4000-8000-000000000002';
delete from auth.users where id = 'a4000000-0000-4000-8000-000000000001';
