-- Prüft die Rotation des Vault-Keys (0007_key_rotation.sql).

\set ON_ERROR_STOP on

insert into auth.users (id, email, email_confirmed_at) values
  ('a7000000-0000-4000-8000-000000000001', 'rotation@example.com', now()),
  ('a7000000-0000-4000-8000-000000000009', 'fremd@example.com', now());

insert into public.vaults (id, owner_id, keyring) values (
  'a7000000-0000-4000-8000-000000000002',
  'a7000000-0000-4000-8000-000000000001',
  '{"vaultId": "a7000000-0000-4000-8000-000000000002", "keyVersion": 1,
    "passphrase": {"wrapped": "p1"}, "recovery": {"wrapped": "r1"},
    "identityPublicKey": "pub", "identityPrivateKey": {"ct": "priv1"}}'::jsonb
);
insert into public.vault_members (vault_id, user_id) values
  ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001');
insert into public.subscriptions (user_id, provider_sub_id, status, current_period_end)
values ('a7000000-0000-4000-8000-000000000001', 'sub_rot', 'active', now() + interval '30 days');
insert into public.api_tokens (id, user_id, vault_id, name, scope, auth_hash, wrapped_vault_key) values (
  'a7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000002', 'Claude', 'write', repeat('a', 64), '{}'::jsonb
);

do $$
declare
  nutzer uuid := 'a7000000-0000-4000-8000-000000000001';
  vault  uuid := 'a7000000-0000-4000-8000-000000000002';
  rec    uuid := 'a7000000-0000-4000-8000-000000000004';
  neu    uuid := 'a7000000-0000-4000-8000-000000000005';
  v2     jsonb;
  seq    bigint;
  n      int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', nutzer)::text, true);
  set local role authenticated;

  perform public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv', 'ct', 'alt-v1', 'keyVersion', 1)));
  select r.server_seq into seq from public.records r where r.id = rec;

  -- Der erste Nachweis wird eingetragen, ein zweiter ueberschreibt ihn nicht.
  assert public.register_key_check(vault, 1, 'beweis-v1'), 'Der erste Nachweis muss eingetragen werden';
  assert not public.register_key_check(vault, 1, 'falsch'), 'Ein vorhandener Nachweis darf nicht ersetzt werden';

  v2 := '{"vaultId": "a7000000-0000-4000-8000-000000000002", "keyVersion": 2,
          "passphrase": {"wrapped": "p2"}, "recovery": {"wrapped": "r2"},
          "identityPublicKey": "pub", "identityPrivateKey": {"ct": "priv2"},
          "previousKeys": [{"keyVersion": 1, "wrapped": {}}]}'::jsonb;

  -- Ohne den bisherigen Schluessel (gestohlene Sitzung) geht es nicht.
  begin
    perform public.rotate_vault_key(vault, 'geraten', v2, 'beweis-v2');
    raise exception 'Ohne gueltigen Nachweis haette die Rotation scheitern muessen';
  exception when sqlstate 'TP008' then null;
  end;
  -- Version muss genau eins weiter sein, die Identitaet bleibt.
  begin
    perform public.rotate_vault_key(vault, 'beweis-v1', jsonb_set(v2, '{keyVersion}', '3'), 'beweis-v2');
    raise exception 'Ein Sprung in der Version haette scheitern muessen';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.rotate_vault_key(vault, 'beweis-v1', jsonb_set(v2, '{identityPublicKey}', '"anders"'), 'beweis-v2');
    raise exception 'Eine neue Identitaet haette scheitern muessen';
  exception when invalid_parameter_value then null;
  end;

  perform public.rotate_vault_key(vault, 'beweis-v1', v2, 'beweis-v2');

  -- Ab jetzt nur noch mit dem neuen Schluessel.
  begin
    perform public.push_records(vault, jsonb_build_array(jsonb_build_object(
      'id', neu, 'hlc', '000000000000020:0000:bbbb', 'iv', 'iv', 'ct', 'mit-v1', 'keyVersion', 1)));
    raise exception 'Ein Push mit dem alten Schluessel haette scheitern muessen';
  exception when sqlstate 'TP007' then null;
  end;

  -- Umschluesseln: gleicher HLC, Stand und Cursor bleiben.
  select public.reencrypt_records(vault, jsonb_build_array(
    jsonb_build_object('id', rec, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv2', 'ct', 'neu-v2', 'keyVersion', 2),
    -- Anderer HLC: das Geraet kennt einen veralteten Stand und darf ihn nicht einspielen.
    jsonb_build_object('id', rec, 'hlc', '000000000000009:0000:aaaa', 'iv', 'x', 'ct', 'veraltet', 'keyVersion', 2)
  )) into n;
  assert n = 1, 'Genau der passende Record muss umgeschluesselt werden';
  -- Ein zweiter Durchlauf aendert nichts mehr.
  select public.reencrypt_records(vault, jsonb_build_array(
    jsonb_build_object('id', rec, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv3', 'ct', 'nochmal', 'keyVersion', 2))) into n;
  assert n = 0, 'Schon umgeschluesselte Records bleiben';
  reset role;

  assert (select ct from public.records where id = rec) = 'neu-v2', 'Der Ciphertext muss ersetzt sein';
  assert (select key_version from public.records where id = rec) = 2, 'Die Schluesselversion muss stimmen';
  assert (select server_seq from public.records where id = rec) = seq, 'Kein Geraet soll neu holen muessen';
  assert not exists (select 1 from public.api_tokens where vault_id = vault), 'Alle API-Tokens muessen widerrufen sein';
  assert (select key_check from public.vaults where id = vault) = encode(sha256(convert_to('beweis-v2', 'UTF8')), 'hex'),
    'Der neue Nachweis muss gelten';
  raise notice 'Rotation: Nachweis, Versionspruefung, Umschluesseln, Tokens - bestanden';
end $$;

-- Ein Fremder darf weder rotieren noch umschluesseln.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'a7000000-0000-4000-8000-000000000009')::text, true);
  set local role authenticated;
  begin
    perform public.rotate_vault_key('a7000000-0000-4000-8000-000000000002', 'beweis-v2', '{}'::jsonb, 'x');
    raise exception 'Ein Fremder haette nicht rotieren duerfen';
  exception when sqlstate 'TP002' then null;
  end;
  begin
    perform public.reencrypt_records('a7000000-0000-4000-8000-000000000002', '[]'::jsonb);
    raise exception 'Ein Fremder haette nicht umschluesseln duerfen';
  exception when sqlstate 'TP002' then null;
  end;
  reset role;
  raise notice 'Rotation: nur fuer Mitglieder bzw. den Eigentuemer - bestanden';
end $$;

delete from public.records where vault_id = 'a7000000-0000-4000-8000-000000000002';
delete from public.subscriptions where provider_sub_id = 'sub_rot';
delete from public.vault_members where vault_id = 'a7000000-0000-4000-8000-000000000002';
delete from public.vaults where id = 'a7000000-0000-4000-8000-000000000002';
delete from auth.users where id in ('a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000009');
