-- Prüft, dass sich am Schlüsselbund nur die Passphrase ändern lässt, und nur vom
-- Eigentümer (0006_change_passphrase.sql).

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('a6000000-0000-4000-8000-000000000001'),
  ('a6000000-0000-4000-8000-000000000002');

insert into public.vaults (id, owner_id, keyring) values (
  'a6000000-0000-4000-8000-000000000003',
  'a6000000-0000-4000-8000-000000000001',
  '{"vaultId": "a6000000-0000-4000-8000-000000000003", "keyVersion": 1,
    "passphrase": {"kdf": {"salt": "alt"}, "wrapped": {"ct": "alt"}},
    "recovery": {"kdf": {"salt": "r"}, "wrapped": {"ct": "r"}},
    "identityPublicKey": "pub", "identityPrivateKey": {"ct": "priv"}}'::jsonb
);

do $$
declare
  eigentuemer uuid := 'a6000000-0000-4000-8000-000000000001';
  fremder     uuid := 'a6000000-0000-4000-8000-000000000002';
  vault       uuid := 'a6000000-0000-4000-8000-000000000003';
  alt         jsonb;
  neu         jsonb;
begin
  select keyring into alt from public.vaults where id = vault;
  neu := jsonb_set(alt, '{passphrase}', '{"kdf": {"salt": "neu"}, "wrapped": {"ct": "neu"}}');

  -- Jemand anderes darf nicht.
  perform set_config('request.jwt.claims', json_build_object('sub', fremder)::text, true);
  set local role authenticated;
  begin
    perform public.update_keyring(vault, neu);
    raise exception 'Ein Fremder haette den Schluesselbund nicht aendern duerfen';
  exception when sqlstate 'TP002' then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', eigentuemer)::text, true);
  set local role authenticated;

  -- Alles ausser der Passphrase bleibt, vor allem der Weg ueber den Wiederherstellungsschluessel.
  begin
    perform public.update_keyring(vault, jsonb_set(neu, '{recovery}', '{"kdf": {}, "wrapped": {}}'));
    raise exception 'Der Wiederherstellungsweg haette sich nicht aendern duerfen';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_keyring(vault, jsonb_set(neu, '{keyVersion}', '2'));
    raise exception 'Die Schluesselversion haette sich nicht aendern duerfen';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_keyring(vault, alt - 'passphrase');
    raise exception 'Ein Schluesselbund ohne Passphrase haette abgelehnt werden muessen';
  exception when invalid_parameter_value then null;
  end;

  perform public.update_keyring(vault, neu);
  reset role;

  assert (select keyring->'passphrase'->'kdf'->>'salt' from public.vaults where id = vault) = 'neu',
    'Die neue Passphrase muss gespeichert sein';
  assert (select keyring->'recovery' from public.vaults where id = vault) = alt->'recovery',
    'Der Wiederherstellungsweg muss unveraendert sein';
  assert not has_function_privilege('anon', 'public.update_keyring(uuid, jsonb)', 'execute'),
    'anon darf update_keyring nicht ausfuehren';
  raise notice 'update_keyring: nur die Passphrase, nur der Eigentuemer - bestanden';
end $$;

delete from public.vaults where id = 'a6000000-0000-4000-8000-000000000003';
delete from auth.users where id in ('a6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000002');
