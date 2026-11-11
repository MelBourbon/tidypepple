-- TidyPepple – Vault-Key erneuern (Rotation).
--
-- Wer den Vault-Key einmal hatte, behält ihn: ein widerrufenes API-Token, ein Gerät, das
-- jemand anderem in die Hände fiel. Passphrase ändern hilft dagegen nicht, denn sie verpackt
-- nur denselben Schlüssel neu (0006). Die Rotation erzeugt einen neuen Vault-Key und
-- verschlüsselt alles, was auf dem Server liegt, mit ihm neu. Danach nützt der alte Schlüssel
-- nur noch für Kopien, die schon jemand gezogen hat.
--
-- Ablauf (src/crypto/keyring.ts `rotateKeyring`, src/sync/engine.ts `reencryptAll`):
--   1. Das Gerät erzeugt den neuen Schlüssel und einen neuen Schlüsselbund. Die alten
--      Schlüssel stehen darin, verpackt mit dem neuen: Was noch nicht umgeschlüsselt ist,
--      bleibt so lesbar.
--   2. `rotate_vault_key` speichert ihn und widerruft alle API-Tokens (sie verpacken den
--      alten Schlüssel).
--   3. `reencrypt_records` ersetzt den Ciphertext Record für Record. Der HLC bleibt, und
--      `server_seq` auch: Inhaltlich ändert sich nichts, kein Gerät muss neu holen, und eine
--      offline gemachte Änderung eines anderen Geräts verliert nicht gegen die Rotation.
--   4. Anhänge werden ersetzt (neue Update-Policy unten).
--
-- Ab Schritt 2 nimmt `write_records` nur noch die aktuelle Schlüsselversion an (TP007). Ein
-- Gerät mit dem alten Schlüssel erfährt so beim nächsten Push davon, sperrt sich und fragt
-- nach der Passphrase. Ohne diese Sperre lüde es weiter mit dem alten Schlüssel hoch.
--
-- Nachweis: Rotieren darf nur, wer den bisherigen Vault-Key hat – nicht schon, wer eine
-- Sitzung erbeutet hat (Zugang zum Postfach reicht dafür). Der Client leitet aus dem Schlüssel
-- per HKDF einen Nachweis ab, der Server speichert davon nur den SHA-256 (`key_check`). Aus
-- dem Nachweis lässt sich der Schlüssel nicht zurückrechnen. Bestehende Vaults haben noch
-- keinen; das nächste Entsperren mit Passphrase trägt ihn nach (`register_key_check`), bis
-- dahin gilt der erste, der kommt.

alter table public.vaults add column key_check text check (key_check is null or key_check ~ '^[0-9a-f]{64}$');

-- Lesbar für Mitglieder wie der Rest der Zeile. Das schadet nicht: Der Nachweis hat 256 Bit
-- Zufall, aus dem Hash lässt er sich nicht zurückrechnen.

create or replace function private.key_check_hash(p_proof text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_proof, ''), 'UTF8')), 'hex');
$$;

-- Nachweis nachtragen, wenn ein Vault noch keinen hat. Ein vorhandener bleibt, wie er ist.
create or replace function public.register_key_check(p_vault_id uuid, p_key_version int, p_proof text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_vault_member(p_vault_id) then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;
  update public.vaults v
  set key_check = private.key_check_hash(p_proof)
  where v.id = p_vault_id
    and v.key_check is null
    and coalesce((v.keyring->>'keyVersion')::int, 1) = p_key_version;
  return found;
end;
$$;

create or replace function public.rotate_vault_key(
  p_vault_id  uuid,
  p_proof     text,
  p_keyring   jsonb,
  p_new_proof text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault public.vaults%rowtype;
  v_old_version int;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = 'TP002';
  end if;

  select * into v_vault from public.vaults v
  where v.id = p_vault_id and v.owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;

  -- Rotieren schreibt den ganzen Bestand neu, das gehört zum Sync.
  if not private.has_active_sync(auth.uid()) then
    raise exception 'Synchronisation erfordert ein aktives Abo.' using errcode = 'TP001';
  end if;

  if v_vault.key_check is not null and v_vault.key_check <> private.key_check_hash(p_proof) then
    raise exception 'Der bisherige Schlüssel stimmt nicht.' using errcode = 'TP008';
  end if;

  v_old_version := coalesce((v_vault.keyring->>'keyVersion')::int, 1);
  if p_keyring is null
    or (p_keyring->>'keyVersion')::int is distinct from v_old_version + 1
    or p_keyring->'vaultId' is distinct from v_vault.keyring->'vaultId'
    or p_keyring->'identityPublicKey' is distinct from v_vault.keyring->'identityPublicKey'
    or jsonb_typeof(p_keyring->'passphrase') is distinct from 'object'
    or jsonb_typeof(p_keyring->'recovery') is distinct from 'object'
    or jsonb_typeof(p_keyring->'previousKeys') is distinct from 'array'
  then
    -- Häufigster Grund: ein anderes Gerät hat gerade selbst rotiert.
    raise exception 'Der Schlüsselbund passt nicht zum aktuellen Stand.' using errcode = '22023';
  end if;

  update public.vaults
  set keyring = p_keyring, key_check = private.key_check_hash(p_new_proof)
  where id = p_vault_id;

  -- Jedes Token verpackt den alten Schlüssel; mit ihm käme es weiter an alles Neue.
  delete from public.api_tokens t where t.vault_id = p_vault_id;
end;
$$;

-- Ciphertext ersetzen, ohne den Stand zu ändern. Nur wo der HLC noch derselbe ist und die
-- Zeile eine ältere Schlüsselversion trägt: Was inzwischen ein Gerät mit dem neuen Schlüssel
-- geschrieben hat, bleibt, wie es ist.
create or replace function public.reencrypt_records(p_vault_id uuid, p_records jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version int;
  v_count   int;
begin
  if auth.uid() is null or not private.is_vault_member(p_vault_id) then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;
  if not private.has_active_sync(auth.uid()) then
    raise exception 'Synchronisation erfordert ein aktives Abo.' using errcode = 'TP001';
  end if;

  -- Dieselbe Sperre wie `write_records`: kein Push schiebt sich dazwischen.
  perform pg_advisory_xact_lock(hashtextextended('push_records:' || p_vault_id::text, 0));
  select coalesce((v.keyring->>'keyVersion')::int, 1) into v_version from public.vaults v where v.id = p_vault_id;

  update public.records r
  set iv = x->>'iv', ct = x->>'ct', key_version = (x->>'keyVersion')::int
  from jsonb_array_elements(p_records) as x
  where r.vault_id = p_vault_id
    and r.id = (x->>'id')::uuid
    and r.hlc = x->>'hlc'
    and (x->>'keyVersion')::int = v_version
    and r.key_version < v_version;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function private.key_check_hash(text) from public, anon, authenticated;
revoke execute on function public.register_key_check(uuid, int, text) from public, anon;
revoke execute on function public.rotate_vault_key(uuid, text, jsonb, text) from public, anon;
revoke execute on function public.reencrypt_records(uuid, jsonb) from public, anon;
grant execute on function public.register_key_check(uuid, int, text) to authenticated;
grant execute on function public.rotate_vault_key(uuid, text, jsonb, text) to authenticated;
grant execute on function public.reencrypt_records(uuid, jsonb) to authenticated;

-- Unverändert gegenüber 0005 bis auf die Prüfung der Schlüsselversion am Anfang.
create or replace function private.write_records(p_vault_id uuid, p_records jsonb)
returns table (id uuid, server_seq bigint)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_before  bigint;
  v_after   bigint;
  v_quota   bigint;
  v_version int;
begin
  perform pg_advisory_xact_lock(hashtextextended('push_records:' || p_vault_id::text, 0));

  -- Nach einer Rotation nur noch mit dem neuen Schlüssel. Ein Schlüsselbund ohne Version
  -- (nur in alten Testdaten) prüft nichts.
  select (v.keyring->>'keyVersion')::int into v_version from public.vaults v where v.id = p_vault_id;
  if v_version is not null and exists (
    select 1 from jsonb_array_elements(p_records) as x where (x->>'keyVersion')::int is distinct from v_version
  ) then
    raise exception 'Der Vault-Schlüssel wurde erneuert.' using errcode = 'TP007';
  end if;

  select coalesce((select u.record_bytes from private.vault_usage u where u.vault_id = p_vault_id), 0)
    into v_before;

  return query
  insert into public.records as r (id, vault_id, hlc, iv, ct, key_version, deleted, server_seq, updated_at)
  select
    (x->>'id')::uuid,
    p_vault_id,
    x->>'hlc',
    x->>'iv',
    x->>'ct',
    (x->>'keyVersion')::int,
    coalesce((x->>'deleted')::boolean, false),
    nextval('public.records_seq'),
    now()
  from jsonb_array_elements(p_records) as x
  on conflict (vault_id, id) do update set
    hlc         = excluded.hlc,
    iv          = excluded.iv,
    ct          = excluded.ct,
    key_version = excluded.key_version,
    deleted     = excluded.deleted,
    server_seq  = nextval('public.records_seq'),
    updated_at  = now()
  where excluded.hlc > r.hlc
  returning r.id, r.server_seq;

  select coalesce((select u.record_bytes from private.vault_usage u where u.vault_id = p_vault_id), 0)
    into v_after;
  select s.record_quota_bytes into v_quota from private.settings s;

  if v_after > v_quota and v_after > v_before then
    raise exception 'Der Speicher für Aufgaben ist voll.' using errcode = 'TP006';
  end if;
end;
$$;

revoke execute on function private.write_records(uuid, jsonb) from public, anon, authenticated;

-- Anhänge ersetzen. 0001 erlaubte kein Update, damit niemand eine Datei austauscht. Löschen
-- und neu hochladen durfte aber jedes Mitglied schon, das Update gibt also keine neue Macht –
-- und es lässt die Rotation eine Datei ersetzen, ohne dass sie zwischendurch fehlt.
create policy "Anhaenge ersetzen" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and private.is_vault_member(public.attachment_vault(name)))
  with check (
    bucket_id = 'attachments'
    and private.is_vault_member(public.attachment_vault(name))
    and private.has_active_sync(auth.uid())
  );
