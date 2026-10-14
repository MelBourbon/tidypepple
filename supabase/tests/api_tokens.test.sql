-- Prüft die API-Tokens (0001_schema.sql, Abschnitt 11): Anlegen, Rechte, Scope, Abo, Widerruf.

\set ON_ERROR_STOP on

-- Wer was aufrufen darf.
do $$
begin
  assert not has_function_privilege('anon', 'public.create_api_token(uuid, uuid, text, text, text, jsonb)', 'execute'),
    'anon darf keine Tokens anlegen';
  assert not has_function_privilege('anon', 'public.revoke_api_token(uuid)', 'execute'),
    'anon darf keine Tokens widerrufen';
  assert has_function_privilege('anon', 'public.api_pull(uuid, text, bigint, integer)', 'execute'),
    'anon muss api_pull aufrufen duerfen - das Token ist der Ausweis';
  assert has_function_privilege('anon', 'public.api_push(uuid, text, jsonb)', 'execute'),
    'anon muss api_push aufrufen duerfen';
  assert not has_function_privilege('anon', 'private.api_token_check(uuid, text, boolean)', 'execute'),
    'anon darf die Pruefung nicht direkt aufrufen';
  assert not has_function_privilege('authenticated', 'private.api_token_check(uuid, text, boolean)', 'execute'),
    'authenticated darf die Pruefung nicht direkt aufrufen';
  assert not has_function_privilege('anon', 'private.write_records(uuid, jsonb)', 'execute'),
    'anon darf nicht ungeprueft schreiben';
  assert not has_table_privilege('anon', 'public.api_tokens', 'select'), 'anon darf keine Tokens lesen';
  assert not has_column_privilege('authenticated', 'public.api_tokens', 'auth_hash', 'select'),
    'Der Hash darf nicht lesbar sein';
  assert not has_column_privilege('authenticated', 'public.api_tokens', 'wrapped_vault_key', 'select'),
    'Der verpackte Schluessel darf nicht lesbar sein';
  assert not has_table_privilege('authenticated', 'public.api_tokens', 'insert'),
    'Anlegen nur ueber create_api_token';
  raise notice 'api_tokens: Rechte - bestanden';
end $$;

-- Vorbereitung: ein zahlender Nutzer mit Vault, ein Fremder mit eigenem Vault.
insert into auth.users (id) values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002');
insert into public.profiles (id, plan) values
  ('a1000000-0000-4000-8000-000000000001', 'premium'),
  ('a2000000-0000-4000-8000-000000000002', 'premium');
insert into public.vaults (id, owner_id, keyring) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '{"keyVersion": 1}'::jsonb),
  ('b2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', '{"keyVersion": 1}'::jsonb);
insert into public.vault_members (vault_id, user_id) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002');

-- Anlegen als Nutzer; fremder Vault scheitert.
do $$
declare
  ich    uuid := 'a1000000-0000-4000-8000-000000000001';
  vault  uuid := 'b1000000-0000-4000-8000-000000000001';
  fremd  uuid := 'b2000000-0000-4000-8000-000000000002';
  n      int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ich)::text, true);
  set local role authenticated;

  perform public.create_api_token('c1000000-0000-4000-8000-000000000001', vault, 'Lesen', 'read',
    encode(sha256(convert_to('geheim-lesen', 'UTF8')), 'hex'), '{"iv":"i","ct":"c","keyVersion":0}'::jsonb);
  perform public.create_api_token('c2000000-0000-4000-8000-000000000002', vault, 'Schreiben', 'write',
    encode(sha256(convert_to('geheim-schreiben', 'UTF8')), 'hex'), '{"iv":"i","ct":"c","keyVersion":0}'::jsonb);

  begin
    perform public.create_api_token(gen_random_uuid(), fremd, 'Fremd', 'read',
      encode(sha256(convert_to('x', 'UTF8')), 'hex'), '{}'::jsonb);
    reset role;
    raise exception 'Token fuer fremden Vault haette scheitern muessen';
  exception
    when sqlstate 'TP002' then null;
  end;

  select count(*) into n from public.api_tokens;
  assert n = 2, 'Nutzer muss genau seine zwei Tokens sehen';
  reset role;

  -- Der Fremde sieht sie nicht.
  perform set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-4000-8000-000000000002')::text, true);
  set local role authenticated;
  select count(*) into n from public.api_tokens;
  assert n = 0, 'Fremde Tokens duerfen nicht sichtbar sein';
  reset role;

  raise notice 'create_api_token: anlegen, fremder Vault, Sichtbarkeit - bestanden';
end $$;

-- Benutzen als anon: Sitzung, Push, Pull, Scope, falsches Geheimnis.
do $$
declare
  lesen      uuid := 'c1000000-0000-4000-8000-000000000001';
  schreiben  uuid := 'c2000000-0000-4000-8000-000000000002';
  sitzung    jsonb;
  n          int;
begin
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;

  sitzung := public.api_session(schreiben, 'geheim-schreiben');
  assert sitzung->>'vaultId' = 'b1000000-0000-4000-8000-000000000001', 'Sitzung muss den Vault nennen';
  assert (sitzung->>'keyVersion')::int = 1, 'Sitzung muss die Schluesselversion nennen';
  assert sitzung->>'scope' = 'write', 'Sitzung muss den Scope nennen';

  select count(*) into n from public.api_push(schreiben, 'geheim-schreiben', jsonb_build_array(jsonb_build_object(
    'id', 'd1000000-0000-4000-8000-000000000001', 'hlc', '000000000000010:0000:aaaa',
    'iv', 'iv', 'ct', 'ct', 'keyVersion', 1)));
  assert n = 1, 'Schreib-Token muss pushen koennen';

  select count(*) into n from public.api_pull(lesen, 'geheim-lesen', 0, 100);
  assert n = 1, 'Lese-Token muss den Record sehen';

  begin
    perform public.api_push(lesen, 'geheim-lesen', '[]'::jsonb);
    reset role;
    raise exception 'Lese-Token haette nicht pushen duerfen';
  exception
    when sqlstate 'TP005' then null;
  end;

  begin
    perform public.api_pull(lesen, 'falsch', 0, 100);
    reset role;
    raise exception 'Falsches Geheimnis haette scheitern muessen';
  exception
    when sqlstate 'TP004' then null;
  end;

  assert public.api_epoch(lesen, 'geheim-lesen') is not null, 'Epoche muss lesbar sein';
  reset role;

  assert (select last_used_at from public.api_tokens where id = lesen) is not null,
    'Benutzung muss vermerkt werden';
  raise notice 'api_*: Sitzung, Push, Pull, Scope, falsches Geheimnis - bestanden';
end $$;

-- Ohne Abo liefert die API nichts, auch nicht lesend.
do $$
begin
  update public.profiles set plan = 'free' where id = 'a1000000-0000-4000-8000-000000000001';

  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin
    perform public.api_pull('c1000000-0000-4000-8000-000000000001', 'geheim-lesen', 0, 100);
    reset role;
    raise exception 'Ohne Abo haette api_pull scheitern muessen';
  exception
    when sqlstate 'TP001' then null;
  end;
  reset role;

  update public.profiles set plan = 'premium' where id = 'a1000000-0000-4000-8000-000000000001';
  raise notice 'api_pull: ohne Abo gesperrt - bestanden';
end $$;

-- Widerrufen: nur eigene, danach ungültig.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-4000-8000-000000000002')::text, true);
  set local role authenticated;
  assert not public.revoke_api_token('c1000000-0000-4000-8000-000000000001'), 'Fremde duerfen nicht widerrufen';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-4000-8000-000000000001')::text, true);
  set local role authenticated;
  assert public.revoke_api_token('c1000000-0000-4000-8000-000000000001'), 'Eigenes Token muss widerrufbar sein';
  reset role;

  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin
    perform public.api_pull('c1000000-0000-4000-8000-000000000001', 'geheim-lesen', 0, 100);
    reset role;
    raise exception 'Widerrufenes Token haette scheitern muessen';
  exception
    when sqlstate 'TP004' then null;
  end;
  reset role;

  -- Wer den Vault verlässt, dessen Tokens gelten nicht mehr.
  delete from public.vault_members
  where vault_id = 'b1000000-0000-4000-8000-000000000001' and user_id = 'a1000000-0000-4000-8000-000000000001';
  set local role anon;
  begin
    perform public.api_session('c2000000-0000-4000-8000-000000000002', 'geheim-schreiben');
    reset role;
    raise exception 'Token ohne Mitgliedschaft haette scheitern muessen';
  exception
    when sqlstate 'TP004' then null;
  end;
  reset role;

  raise notice 'revoke_api_token: Widerruf und Mitgliedschaft - bestanden';
end $$;
