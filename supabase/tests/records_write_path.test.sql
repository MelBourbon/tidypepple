-- Prüft den einzigen Schreibweg für Records und seine Grenzen (0005_records_write_path.sql).

\set ON_ERROR_STOP on

insert into auth.users (id, email, email_confirmed_at)
values ('a5000000-0000-4000-8000-000000000001', 'schreiben@example.com', now());

-- ---------------------------------------------------------------------------
-- Direkt an der Funktion vorbei geht nichts – auch nicht mit Abo
-- ---------------------------------------------------------------------------
do $$
declare
  nutzer uuid := 'a5000000-0000-4000-8000-000000000001';
  vault  uuid := 'a5000000-0000-4000-8000-000000000002';
  rec    uuid := 'a5000000-0000-4000-8000-000000000003';
  n      int;
begin
  insert into public.vaults (id, owner_id, keyring) values (vault, nutzer, '{}'::jsonb);
  insert into public.vault_members (vault_id, user_id) values (vault, nutzer);
  insert into public.subscriptions (user_id, provider_sub_id, status, current_period_end)
  values (nutzer, 'sub_weg', 'active', now() + interval '30 days');

  perform set_config('request.jwt.claims', json_build_object('sub', nutzer)::text, true);
  set local role authenticated;

  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', rec, 'hlc', '000000000000020:0000:aaaa', 'iv', 'iv', 'ct', 'neu', 'keyVersion', 1)));
  assert n = 1, 'push_records muss schreiben';

  -- Ein aelterer Stand per Update, und eine selbst gewaehlte server_seq per Insert: beides
  -- haette den HLC-Vergleich bzw. die Cursor der anderen Geraete ausgehebelt.
  begin
    update public.records set ct = 'alt', hlc = '000000000000010:0000:aaaa' where id = rec;
    raise exception 'Direktes Update haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.records (id, vault_id, hlc, iv, ct, key_version, server_seq)
    values ('a5000000-0000-4000-8000-000000000004', vault, '000000000000030:0000:aaaa', 'iv', 'ct', 1, 1);
    raise exception 'Direkter Insert haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.records where id = rec;
    raise exception 'Direktes Loeschen haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from private.write_records(vault, '[]'::jsonb);
    raise exception 'write_records haette nicht direkt aufrufbar sein duerfen';
  exception when insufficient_privilege then null;
  end;
  reset role;

  assert (select ct from public.records where id = rec) = 'neu', 'Der Stand darf sich nicht geaendert haben';
  raise notice 'Records: nur ueber push_records - bestanden';
end $$;

-- ---------------------------------------------------------------------------
-- Größe je Record und Kontingent je Vault
-- ---------------------------------------------------------------------------
do $$
declare
  nutzer uuid := 'a5000000-0000-4000-8000-000000000001';
  vault  uuid := 'a5000000-0000-4000-8000-000000000002';
  a      uuid := 'a5000000-0000-4000-8000-000000000011';
  b      uuid := 'a5000000-0000-4000-8000-000000000012';
  n      int;
begin
  -- Der erste Record aus dem Block oben belegt 5 Byte ('iv' + 'neu').
  assert (select record_bytes from private.vault_usage where vault_id = vault) = 5,
    'Der Zaehler muss den vorhandenen Record kennen';
  update private.settings set record_quota_bytes = 2000;

  perform set_config('request.jwt.claims', json_build_object('sub', nutzer)::text, true);
  set local role authenticated;

  -- Zu gross fuer einen einzelnen Record.
  begin
    perform public.push_records(vault, jsonb_build_array(jsonb_build_object(
      'id', a, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv', 'ct', repeat('x', 1048577), 'keyVersion', 1)));
    raise exception 'Ein Record ueber 1 MiB haette abgelehnt werden muessen';
  exception when check_violation then null;
  end;

  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', a, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv', 'ct', repeat('x', 1500), 'keyVersion', 1)));
  assert n = 1, 'Unter dem Kontingent muss geschrieben werden';

  -- Der zweite braechte den Vault ueber 2000 Byte: der ganze Push scheitert.
  begin
    perform public.push_records(vault, jsonb_build_array(
      jsonb_build_object('id', b, 'hlc', '000000000000010:0000:aaaa', 'iv', 'iv', 'ct', repeat('y', 600), 'keyVersion', 1)));
    raise exception 'Ueber dem Kontingent haette der Push scheitern muessen';
  exception when sqlstate 'TP006' then null;
  end;

  -- Was nicht groesser wird, geht auch dann durch, wenn der Vault voll ist.
  reset role;
  update private.settings set record_quota_bytes = 100;
  set local role authenticated;
  select count(*) into n from public.push_records(vault, jsonb_build_array(jsonb_build_object(
    'id', a, 'hlc', '000000000000011:0000:aaaa', 'iv', 'iv', 'ct', 'geloescht', 'deleted', true, 'keyVersion', 1)));
  assert n = 1, 'Eine Loeschung muss auch ueber dem Kontingent durchgehen';
  reset role;

  assert not exists (select 1 from public.records where id = b), 'Vom abgelehnten Push darf nichts bleiben';
  assert (select record_bytes from private.vault_usage where vault_id = vault)
       = (select sum(length(ct) + length(iv)) from public.records where vault_id = vault),
    'Der Zaehler muss der tatsaechlichen Belegung entsprechen';
  raise notice 'Records: Groesse und Kontingent - bestanden';
end $$;

update private.settings set record_quota_bytes = 52428800;
delete from public.records where vault_id = 'a5000000-0000-4000-8000-000000000002';
delete from public.subscriptions where provider_sub_id = 'sub_weg';
delete from public.vault_members where vault_id = 'a5000000-0000-4000-8000-000000000002';
delete from public.vaults where id = 'a5000000-0000-4000-8000-000000000002';
delete from auth.users where id = 'a5000000-0000-4000-8000-000000000001';
