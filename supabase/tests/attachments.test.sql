-- Prüft Bucket, Policies und Kontingent der Anhänge (0001_schema.sql, Abschnitt 8).
--
-- Die Policies sind die eigentliche Durchsetzung: der Client ist eine statische PWA und
-- kann alles behaupten. Deshalb wird hier als `authenticated` mit echtem RLS geschrieben.

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('a1111111-1111-4111-8111-111111111111'),
  ('a2222222-2222-4222-8222-222222222222');
insert into public.profiles (id, plan) values
  ('a1111111-1111-4111-8111-111111111111', 'premium'),
  ('a2222222-2222-4222-8222-222222222222', 'free');
insert into public.vaults (id, owner_id, keyring) values
  ('a3333333-3333-4333-8333-333333333333', 'a1111111-1111-4111-8111-111111111111', '{}'::jsonb);
insert into public.vault_members (vault_id, user_id) values
  ('a3333333-3333-4333-8333-333333333333', 'a1111111-1111-4111-8111-111111111111');

do $$
begin
  assert (select not public from storage.buckets where id = 'attachments'), 'Bucket muss privat sein';
  assert (select file_size_limit from storage.buckets where id = 'attachments') between 5242880 and 5300000,
    'Bucket-Grenze muss knapp ueber 5 MiB liegen';

  assert public.attachment_vault('a3333333-3333-4333-8333-333333333333/t/a')
    = 'a3333333-3333-4333-8333-333333333333', 'Vault aus gueltigem Pfad';
  assert public.attachment_vault('kein-uuid/t/a') is null, 'Ungueltige Vault-ID ergibt null';
  assert public.attachment_vault('a3333333-3333-4333-8333-333333333333/a') is null, 'Zu kurzer Pfad ergibt null';
  assert public.attachment_vault('a3333333-3333-4333-8333-333333333333/t/a/x') is null, 'Zu langer Pfad ergibt null';
  raise notice 'attachment_vault: bestanden';
end $$;

-- Mitglied mit Abo: hochladen, lesen, löschen.
do $$
declare
  vault text := 'a3333333-3333-4333-8333-333333333333';
  gesehen integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'a1111111-1111-4111-8111-111111111111')::text, true);
  set local role authenticated;

  assert public.attachment_upload_status(vault::uuid) = 'ok', 'Mit Abo und Platz: ok';
  insert into storage.objects (bucket_id, name, metadata)
  values ('attachments', vault || '/task1/att1', '{"size": 1000}');
  select count(*) into gesehen from storage.objects where bucket_id = 'attachments';
  assert gesehen = 1, 'Eigenes Objekt muss lesbar sein';

  -- Ersetzen ist nicht vorgesehen.
  update storage.objects set metadata = '{"size": 1}' where name = vault || '/task1/att1';
  get diagnostics gesehen = row_count;
  assert gesehen = 0, 'Anhaenge duerfen nicht ueberschrieben werden';

  begin
    insert into storage.objects (bucket_id, name) values ('attachments', vault || '/zu-kurz');
    reset role;
    raise exception 'Ungueltiger Pfad haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;

  delete from storage.objects where name = vault || '/task1/att1';
  get diagnostics gesehen = row_count;
  assert gesehen = 1, 'Mitglied muss loeschen duerfen';
  reset role;
  raise notice 'Mitglied mit Abo: hochladen, lesen, loeschen - bestanden';
end $$;

-- Fremde sehen nichts und schreiben nichts.
do $$
declare
  vault text := 'a3333333-3333-4333-8333-333333333333';
  gesehen integer;
begin
  insert into storage.objects (bucket_id, name, metadata) values ('attachments', vault || '/task1/att2', '{"size": 10}');

  perform set_config('request.jwt.claims', json_build_object('sub', 'a2222222-2222-4222-8222-222222222222')::text, true);
  set local role authenticated;
  select count(*) into gesehen from storage.objects where bucket_id = 'attachments';
  assert gesehen = 0, 'Fremde duerfen keine Anhaenge sehen';

  delete from storage.objects where bucket_id = 'attachments';
  get diagnostics gesehen = row_count;
  assert gesehen = 0, 'Fremde duerfen nichts loeschen';

  begin
    insert into storage.objects (bucket_id, name) values ('attachments', vault || '/task1/fremd');
    reset role;
    raise exception 'Fremder Upload haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.attachment_upload_status(vault::uuid);
    reset role;
    raise exception 'attachment_upload_status haette TP002 werfen muessen';
  exception when sqlstate 'TP002' then null;
  end;
  reset role;
  raise notice 'Fremde: kein Zugriff - bestanden';
end $$;

-- Ohne Abo: lesen ja, hochladen nein.
do $$
declare
  vault text := 'a3333333-3333-4333-8333-333333333333';
  gesehen integer;
begin
  update public.profiles set plan = 'free' where id = 'a1111111-1111-4111-8111-111111111111';

  perform set_config('request.jwt.claims', json_build_object('sub', 'a1111111-1111-4111-8111-111111111111')::text, true);
  set local role authenticated;
  assert public.attachment_upload_status(vault::uuid) = 'entitlement', 'Ohne Abo: entitlement';
  select count(*) into gesehen from storage.objects where bucket_id = 'attachments';
  assert gesehen = 1, 'Ohne Abo muss Lesen weiter gehen';
  begin
    insert into storage.objects (bucket_id, name) values ('attachments', vault || '/task1/ohne-abo');
    reset role;
    raise exception 'Upload ohne Abo haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;
  reset role;

  update public.profiles set plan = 'premium' where id = 'a1111111-1111-4111-8111-111111111111';
  raise notice 'Ohne Abo: Lesen ja, Hochladen nein - bestanden';
end $$;

-- Kontingent: ab 200 MiB ist Schluss.
do $$
declare
  vault text := 'a3333333-3333-4333-8333-333333333333';
begin
  insert into storage.objects (bucket_id, name, metadata)
  values ('attachments', vault || '/task2/gross', json_build_object('size', 209715200 - 10)::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', 'a1111111-1111-4111-8111-111111111111')::text, true);
  set local role authenticated;
  assert public.attachment_upload_status(vault::uuid) = 'quota', 'Voller Vault: quota';
  begin
    insert into storage.objects (bucket_id, name) values ('attachments', vault || '/task2/zu-viel');
    reset role;
    raise exception 'Upload ueber dem Kontingent haette scheitern muessen';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'Kontingent: bestanden';
end $$;

delete from storage.objects where bucket_id = 'attachments';
delete from public.vault_members where vault_id = 'a3333333-3333-4333-8333-333333333333';
delete from public.vaults where id = 'a3333333-3333-4333-8333-333333333333';
