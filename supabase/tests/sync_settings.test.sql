-- Prüft den Schalter `private.settings.require_subscription` (0002_sync_settings.sql):
-- Standard ist die Abo-Pflicht, abgeschaltet darf jedes Konto synchronisieren.

\set ON_ERROR_STOP on

insert into auth.users (id) values ('55555555-5555-4555-8555-555555555555');
insert into public.vaults (id, owner_id, keyring)
  values ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', '{}'::jsonb);
insert into public.vault_members (vault_id, user_id)
  values ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555');

do $$
declare
  nutzer uuid := '55555555-5555-4555-8555-555555555555';
  vault  uuid := '66666666-6666-4666-8666-666666666666';
  n      integer;
begin
  assert (select require_subscription from private.settings), 'Standard muss die Abo-Pflicht sein';
  assert (select count(*) from private.settings) = 1, 'Es darf genau eine Einstellungszeile geben';
  assert not private.has_active_sync(nutzer), 'Mit Abo-Pflicht darf ein Konto ohne Abo nicht synchronisieren';

  update private.settings set require_subscription = false;
  assert private.has_active_sync(nutzer), 'Ohne Abo-Pflicht muss jedes Konto berechtigt sein';
  assert not private.has_active_sync(null), 'Ohne Konto gibt es auch ohne Abo-Pflicht keine Berechtigung';

  -- Durchgehend bis zum Schreiben: Policy und push_records fragen dieselbe Funktion.
  perform set_config('request.jwt.claims', json_build_object('sub', nutzer)::text, true);
  set local role authenticated;
  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', '77777777-7777-4777-8777-777777777777', 'hlc', '000000000000010:0000:aaaa',
    'iv', 'iv', 'ct', 'ct', 'keyVersion', 1)));
  assert n = 1, 'Ohne Abo-Pflicht muss push_records schreiben';
  assert public.attachment_upload_status(vault) = 'ok', 'Ohne Abo-Pflicht muessen Anhaenge erlaubt sein';
  reset role;

  update private.settings set require_subscription = true;
  assert not private.has_active_sync(nutzer), 'Wieder eingeschaltet muss die Abo-Pflicht greifen';
  raise notice 'require_subscription: Standard, aus, wieder an - bestanden';
end $$;

-- Den Schalter darf nur der Datenbankeigentümer sehen und ändern.
do $$
begin
  assert not has_table_privilege('authenticated', 'private.settings', 'select'), 'authenticated darf die Einstellungen nicht lesen';
  assert not has_table_privilege('authenticated', 'private.settings', 'update'), 'authenticated darf die Einstellungen nicht aendern';
  assert not has_table_privilege('anon', 'private.settings', 'update'), 'anon darf die Einstellungen nicht aendern';
  raise notice 'private.settings: nur fuer den Eigentuemer - bestanden';
end $$;

delete from public.records where vault_id = '66666666-6666-4666-8666-666666666666';
delete from public.vault_members where vault_id = '66666666-6666-4666-8666-666666666666';
delete from public.vaults where id = '66666666-6666-4666-8666-666666666666';
delete from auth.users where id = '55555555-5555-4555-8555-555555555555';
