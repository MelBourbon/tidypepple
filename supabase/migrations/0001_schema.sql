-- TidyPepple – Sync-Backend.
--
-- Der Server speichert ausschließlich undurchsichtige Blobs: Titel, Notizen, Kontexte und
-- Daten liegen im Ciphertext. Lesbar sind nur die Metadaten, die für den Transport nötig
-- sind (Record-ID, Vault, HLC, Schlüsselversion, Reihenfolge, Löschmarkierung).
--
-- Mehrmandantenfähig ab Tag 1: jeder Record hängt an einem Vault, Zugriff läuft über
-- `vault_members`. Geteilte Vaults (Teams) brauchen später keine Schemaänderung, sondern
-- nur einen weiteren Mitgliedseintrag mit dem für dessen Public Key verpackten Vault-Key.
--
-- Das Gate für den bezahlten Sync gehört auf den Server. Der Client ist eine statische PWA,
-- die jeder verändern kann – eine Prüfung dort ist Kosmetik, keine Durchsetzung. Die
-- Gratis-Version bleibt offline vollwertig und fasst den Server nie an.
--
-- Diese Datei ist der Gesamtstand. Spätere Änderungen kommen als eigene Migrationen dazu
-- (0002_…, 0003_… in dieser Reihenfolge).
--
-- Gliederung:
--   1. Schema `private`
--   2. Konten, Vaults, Records
--   3. Abonnements
--   4. Berechtigung: is_vault_member, has_active_sync
--   5. Policies
--   6. Vault anlegen, Records schreiben
--   7. Server-Epoche
--   8. Anhänge
--   9. Abo-Events (Webhook)
--  10. Nutzungszahlen
--  11. API-Tokens für den MCP-Server

create extension if not exists pgcrypto;

-- ===========================================================================
-- 1. Schema `private`
--
-- Hilfsfunktionen, die Policies brauchen, aber nicht über /rest/v1/rpc/… aufrufbar sein
-- dürfen – etwa `has_active_sync`, mit der sich sonst für fremde User-IDs abfragen ließe, ob
-- ein Abo besteht. PostgREST veröffentlicht dieses Schema nicht. Policies verweisen auf die
-- Funktion selbst und brauchen nur das Ausführungsrecht.
-- ===========================================================================
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ===========================================================================
-- 2. Konten, Vaults, Records
-- ===========================================================================

-- Konten und Abrechnung: bewusst im Klartext. Limits müssen aus Metadaten ableitbar sein –
-- bei E2E kann der Server Inhalte nicht zur Abrechnung heranziehen.
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  plan        text not null default 'free',
  created_at  timestamptz not null default now()
);

create table public.vaults (
  id          uuid primary key,
  owner_id    uuid not null references auth.users on delete cascade,
  -- Der Schlüsselbund: ausschließlich verpacktes Schlüsselmaterial. Er liegt hier, damit
  -- ein zweites Gerät nach dem Login nur noch die Passphrase braucht.
  keyring     jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.vault_members (
  vault_id          uuid not null references public.vaults on delete cascade,
  user_id           uuid not null references auth.users on delete cascade,
  role              text not null default 'owner',
  -- Für spätere geteilte Vaults: der Vault-Key, verpackt für den Public Key dieses
  -- Mitglieds. Der Server kann ihn nicht öffnen.
  wrapped_vault_key jsonb,
  created_at        timestamptz not null default now(),
  primary key (vault_id, user_id)
);

create sequence public.records_seq;

create table public.records (
  id          uuid not null,
  vault_id    uuid not null references public.vaults on delete cascade,
  -- Hybrid Logical Clock. Lexikografisch vergleichbar, deshalb kann der Server
  -- Konflikte entscheiden, ohne den Inhalt zu kennen.
  hlc         text not null,
  iv          text not null,
  ct          text not null,
  key_version int  not null,
  -- Cursor für Delta-Pulls; steigt auch bei Updates, sonst würden Änderungen
  -- an bereits synchronisierten Records nie ausgeliefert.
  server_seq  bigint not null default nextval('public.records_seq'),
  updated_at  timestamptz not null default now(),
  -- Tombstone-Markierung, vom Client beim Push gesetzt. Löschen ist ein Soft Delete, sonst
  -- ließe es sich nicht synchronisieren; die Zeile bleibt deshalb für immer stehen.
  --
  -- Die Löschung selbst geht als kleiner verschlüsselter Tombstone hinaus (nur Zeitpunkt und
  -- HLC, kein Inhalt). Dass die Uhr der Löschung *im* Ciphertext steht, ist der Punkt: Wer
  -- die Datenbank beschreiben kann, kann damit keine Aufgabe auf allen Geräten löschen. Der
  -- Client überspringt leeren Ciphertext wie einen unlesbaren Record.
  --
  -- Bewusst in Kauf genommen: Der Server erfährt, welche Records gelöscht sind und wann.
  -- Gemessen an dem, was er ohnehin sieht (IDs, Schreibzeitpunkte, Anzahl, durch UUIDv7
  -- auch die Erstellungszeit), ist das ein kleiner Zuwachs.
  deleted     boolean not null default false,
  primary key (vault_id, id)
);

create index records_pull_idx on public.records (vault_id, server_seq);

-- Realtime: der Client bekommt nur ein Signal und holt dann selbst – die Nutzlast
-- der Benachrichtigung wird nie gebraucht.
alter publication supabase_realtime add table public.records;

-- ===========================================================================
-- 3. Abonnements
-- ===========================================================================
create table public.subscriptions (
  -- Null bei einem Kauf ohne Konto („erst bezahlen, dann anmelden“): Das Abo hängt dann an
  -- `email` und gilt für das Konto mit derselben, bestätigten Adresse.
  user_id              uuid references auth.users on delete cascade,
  provider             text not null default 'lemonsqueezy',
  provider_customer_id text,
  -- Eindeutig über die ID beim Anbieter, die der Webhook immer mitschreibt.
  provider_sub_id      text not null,

  -- Normalisiertes, anbieterunabhängiges Vokabular.
  status               text not null check (status in ('active', 'past_due', 'paused', 'canceled')),

  -- Rohstatus des Anbieters, unverändert. Bei Webhook- und Supportproblemen lautet die
  -- Frage immer "was kam wirklich an" – das darf die Normalisierung nicht verschlucken.
  provider_status      text,

  -- Maßgeblich für die Berechtigung. Bei LemonSqueezy bedeutet "cancelled" gekündigt,
  -- aber weiterlaufend bis zum Periodenende – wer auf den Status allein sperrt, nimmt
  -- zahlenden Kunden bereits bezahlte Zeit weg.
  current_period_end   timestamptz,

  -- Zeitstempel des Anbieter-Events, nicht der Empfangszeitpunkt. Webhooks treffen
  -- doppelt und gelegentlich verdreht ein; damit lässt sich ein veralteter Stand verwerfen.
  event_at             timestamptz,
  updated_at           timestamptz not null default now(),

  -- E-Mail aus der Bestellung. Immer kleingeschrieben gespeichert, damit der Abgleich nicht
  -- an der Schreibweise scheitert.
  email                text check (email is null or email = lower(email)),

  primary key (provider_sub_id)
);

-- Doppelt zum Primärschlüssel, aber im Bestand vorhanden (das Abo hing anfangs am Konto).
-- Bleibt, damit eine frische Datenbank dem laufenden Projekt gleicht.
alter table public.subscriptions
  add constraint subscriptions_provider_sub_id_key unique (provider_sub_id);

create index subscriptions_user_idx on public.subscriptions (user_id);
create index subscriptions_email_idx on public.subscriptions (email) where user_id is null;

alter table public.subscriptions enable row level security;

-- ===========================================================================
-- 4. Berechtigung
-- ===========================================================================

-- Eigene Funktion statt Unterabfrage in der Policy: sonst prüft die Policy auf
-- `vault_members` sich selbst und Postgres bricht mit Rekursion ab.
create or replace function private.is_vault_member(p_vault_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vault_members m
    where m.vault_id = p_vault_id and m.user_id = auth.uid()
  );
$$;

-- Ein Abo ohne Konto gilt nur für ein Konto mit *bestätigter* E-Mail-Adresse. Beim Magic
-- Link ist das immer so – aber Supabase erlaubt auch die Registrierung mit Passwort, und
-- ist dort „Confirm email“ abgeschaltet, entstünde ein Konto mit fremder Adresse ohne jeden
-- Nachweis. Die Bedingung hängt deshalb nicht an einer Projekteinstellung.
create or replace function private.has_active_sync(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Manuelle Freischaltung für Rückerstattungen, Testkonten und Freunde. Ohne diesen
    -- Weg wäre jede Sonderbehandlung ein Eingriff beim Zahlungsanbieter.
    exists (
      select 1 from public.profiles p
      where p.id = p_user_id and p.plan = 'premium'
    )
    or exists (
      select 1 from public.subscriptions s
      where (
          s.user_id = p_user_id
          -- Ohne Konto gekauft: gilt für das Konto mit derselben, *bestätigten* E-Mail-Adresse.
          -- Nur für Abos ohne User-ID – ein bereits zugeordnetes Abo wandert nicht mit der Adresse.
          or (
            s.user_id is null
            and s.email = (
              select lower(u.email) from auth.users u
              where u.id = p_user_id and u.email_confirmed_at is not null
            )
          )
        )
        and (
          -- Laufendes Abo. `past_due` bleibt berechtigt: eine abgelaufene Karte soll
          -- nicht sofort den Sync kappen, das erzeugt nur Supportfälle.
          -- `current_period_end is null` deckt unbefristete Freischaltungen ab.
          (
            s.status in ('active', 'past_due')
            and (s.current_period_end is null or s.current_period_end > now())
          )
          -- Gekündigt, aber bezahlte Zeit läuft noch. Wer hier sofort sperrt, nimmt
          -- zahlenden Kunden Zeit weg, die sie bereits bezahlt haben.
          -- Ohne bekanntes Periodenende gibt es dagegen nichts mehr zu gewähren.
          or (s.status = 'canceled' and s.current_period_end > now())
          -- `paused` fällt bewusst durch: pausiert heißt nicht nutzbar.
        )
    );
$$;

comment on function private.has_active_sync(uuid) is
  'Einzige Quelle der Berechtigung. Wird von der RLS-Policy und von push_records() benutzt, damit die Regel nur einmal existiert.';

-- Die Policies rufen beide Funktionen mit den Rechten des Nutzers auf.
revoke execute on function private.is_vault_member(uuid) from public, anon;
revoke execute on function private.has_active_sync(uuid) from public, anon;
grant execute on function private.is_vault_member(uuid) to authenticated;
grant execute on function private.has_active_sync(uuid) to authenticated;

-- ===========================================================================
-- 5. Policies
--
-- Lesen und Schreiben sind getrennt. Daraus entsteht "Pull ja, Push nein": Wer nicht mehr
-- zahlt, kommt weiterhin an alle eigenen Daten und kann ein neues Gerät befüllen – gesperrt
-- ist nur das Hochladen. Lokal bleibt ohnehin alles erhalten.
--
-- Die Policies gelten nur für `authenticated`. Für `anon` greift keine, die Tabellen bleiben
-- leer, und die Hilfsfunktionen werden gar nicht erst ausgewertet.
-- ===========================================================================
alter table public.profiles      enable row level security;
alter table public.vaults        enable row level security;
alter table public.vault_members enable row level security;
alter table public.records       enable row level security;

-- Nur lesen: `plan = 'premium'` ist eine Freischaltung, sie setzt nur der Admin im
-- SQL-Editor. Angelegt wird das Profil in `ensure_vault()`.
create policy "eigenes Profil lesen" on public.profiles
  for select to authenticated using (id = auth.uid());

revoke insert, update, delete, truncate on public.profiles from public, anon, authenticated;

create policy "eigene Vaults lesen" on public.vaults
  for select to authenticated using (private.is_vault_member(id));

create policy "eigene Mitgliedschaften lesen" on public.vault_members
  for select using (user_id = auth.uid());

create policy "Records lesen" on public.records
  for select to authenticated using (private.is_vault_member(vault_id));

create policy "Records schreiben" on public.records
  for insert to authenticated with check (
    private.is_vault_member(vault_id) and private.has_active_sync(auth.uid())
  );

create policy "Records ändern" on public.records
  for update to authenticated
  using (private.is_vault_member(vault_id) and private.has_active_sync(auth.uid()))
  with check (private.is_vault_member(vault_id) and private.has_active_sync(auth.uid()));

-- Lesen darf der Eigentümer, schreiben nur der Webhook (Service-Role umgeht RLS).
-- Kein INSERT/UPDATE für Nutzer: sonst schaltet sich jeder selbst frei.
create policy "eigenes Abo lesen" on public.subscriptions
  for select using (user_id = auth.uid());

-- ===========================================================================
-- 6. Vault anlegen, Records schreiben
-- ===========================================================================

-- Vault anlegen oder übernehmen. Ein zweites Gerät erhält hier den bestehenden
-- Schlüsselbund zurück, statt versehentlich einen zweiten Vault zu erzeugen.
create or replace function public.ensure_vault(p_vault_id uuid, p_keyring jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.vaults%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  insert into public.profiles (id) values (auth.uid()) on conflict (id) do nothing;

  -- Hat dieser Nutzer bereits einen Vault, gilt dieser – unabhängig davon, was das
  -- Gerät vorschlägt.
  select v.* into v_existing
  from public.vaults v
  join public.vault_members m on m.vault_id = v.id
  where m.user_id = auth.uid()
  order by v.created_at
  limit 1;

  if found then
    return jsonb_build_object('vaultId', v_existing.id, 'keyring', v_existing.keyring);
  end if;

  insert into public.vaults (id, owner_id, keyring) values (p_vault_id, auth.uid(), p_keyring);
  insert into public.vault_members (vault_id, user_id, role) values (p_vault_id, auth.uid(), 'owner');

  return jsonb_build_object('vaultId', p_vault_id, 'keyring', p_keyring);
end;
$$;

revoke execute on function public.ensure_vault(uuid, jsonb) from public, anon;

-- Schreiben ohne Prüfung: der gemeinsame Kern von `push_records` (Gerät) und `api_push`
-- (Token). Beide prüfen vorher selbst, wer schreiben darf.
--
-- Last-Writer-Wins auf der opaken HLC-Spalte: ein Nachzügler mit älterem Zeitstempel wird
-- verworfen, ohne dass der Server den Inhalt kennen muss.
--
-- Die Sperre je Vault: Der Pull-Cursor ist `server_seq`, und `nextval` vergibt die Nummer
-- beim Schreiben, sichtbar wird sie aber erst beim Commit. Pushen zwei Geräte gleichzeitig,
-- könnte 101 vor 100 committen; ein drittes Gerät, das genau dazwischen holt, setzte seinen
-- Cursor auf 101 und bekäme 100 nie. Mit der Sperre wartet der zweite Push, bis der erste
-- committet hat. Verschiedene Vaults sperren sich nicht gegenseitig.
--
-- `#variable_conflict use_column`: Die Ergebnisspalten `id` und `server_seq` sind in
-- PL/pgSQL zugleich Variablen, ohne die Anweisung wäre `on conflict (vault_id, id)`
-- mehrdeutig.
create or replace function private.write_records(p_vault_id uuid, p_records jsonb)
returns table (id uuid, server_seq bigint)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  -- Gilt bis zum Ende der Transaktion, also bis nach dem Commit der Nummern unten.
  perform pg_advisory_xact_lock(hashtextextended('push_records:' || p_vault_id::text, 0));

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
end;
$$;

-- `push_records` läuft mit den Rechten des Geräts und braucht die Funktion deshalb auch.
-- Als `security invoker` greift für das Gerät weiterhin RLS.
revoke execute on function private.write_records(uuid, jsonb) from public, anon;
grant execute on function private.write_records(uuid, jsonb) to authenticated;

-- Die Prüfung steht hier zusätzlich zur Policy, und das ist kein Versehen: Die Policy
-- allein würde einen Push nur auf null betroffene Zeilen laufen lassen. Der Client hielte
-- ihn für erfolgreich und leerte die Outbox – stiller Datenverlust.
--
-- TP001 ist ein eigener SQLSTATE, damit der Client "nicht bezahlt" von "Netz weg"
-- unterscheiden und gezielt die Kaufaufforderung zeigen kann.
create or replace function public.push_records(p_vault_id uuid, p_records jsonb)
returns table (id uuid, server_seq bigint)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not private.is_vault_member(p_vault_id) then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;

  if not private.has_active_sync(auth.uid()) then
    raise exception 'Synchronisation erfordert ein aktives Abo.' using errcode = 'TP001';
  end if;

  return query select * from private.write_records(p_vault_id, p_records);
end;
$$;

-- ===========================================================================
-- 7. Server-Epoche
--
-- Geräte holen nur Records mit `server_seq > cursor`. Nach einem Restore steht
-- `records_seq` wieder auf dem Stand des Backups, also unter den Cursorn der Geräte: Neue
-- Änderungen sähen sie nie, und was seit dem Backup verloren ging, lädt kein Gerät neu
-- hoch, denn ihre Outbox ist leer. Die Geräte liefen still auseinander.
--
-- Die Epoche ist eine Kennung des Datenbestands. Wer ein Backup einspielt, setzt danach
-- eine neue (`select private.rotate_sync_epoch();`, siehe docs/restore.md). Ein Gerät, das
-- eine andere Epoche sieht als beim letzten Sync, setzt seinen Cursor zurück und schiebt
-- alles noch einmal hoch. Doppeltes verwirft `write_records` am HLC-Vergleich.
--
-- Automatisch erkennen lässt sich ein Restore nicht: Das Backup enthält die alte Epoche,
-- und die Sequence läuft nach dem Restore bald wieder über die alten Cursor hinaus.
-- ===========================================================================
create table private.sync_epoch (
  only_row   boolean primary key default true check (only_row),
  epoch      uuid not null default gen_random_uuid(),
  changed_at timestamptz not null default now()
);

insert into private.sync_epoch default values;

create or replace function public.sync_epoch()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select epoch from private.sync_epoch;
$$;

-- Verrät nichts über Konten oder Vaults, ist aber nur für Geräte mit Sync da.
revoke execute on function public.sync_epoch() from public, anon;
grant execute on function public.sync_epoch() to authenticated;

-- Nur im SQL-Editor bzw. als Datenbankeigentümer: `private` ist für PostgREST unsichtbar,
-- und ausführen darf die Funktion niemand sonst.
create or replace function private.rotate_sync_epoch()
returns uuid
language sql
volatile
set search_path = ''
as $$
  update private.sync_epoch
  set epoch = gen_random_uuid(), changed_at = now()
  returning epoch;
$$;

revoke execute on function private.rotate_sync_epoch() from public, anon, authenticated;

-- ===========================================================================
-- 8. Anhänge
--
-- Die Dateien liegen nicht in `records`: jeder Pull holt dort alles Geänderte, und der
-- Ciphertext ist Base64-Text. Ein paar Fotos würden jeden Sync ausbremsen. Stattdessen ein
-- privater Storage-Bucket; die Metadaten (Name, Typ, Größe) reisen weiter verschlüsselt
-- mit der Aufgabe.
--
-- Pfad: <vault_id>/<task_id>/<attachment_id>. Inhalt: vom Client mit dem Vault-Schlüssel
-- verschlüsselt, Content-Type immer application/octet-stream.
--
-- Bewusst in Kauf genommener Metadaten-Verlust: Der Server sieht, wie viele Anhänge eine
-- Aufgabe hat und wie groß sie sind. Die Aufgaben-ID kennt er ohnehin als Record-ID.
-- ===========================================================================

-- 5 MiB Nutzlast plus Verschlüsselungs-Overhead (17 Byte Kopf, 16 Byte GCM-Tag), großzügig
-- aufgerundet. Die eigentliche 5-MB-Grenze prüft der Client vor dem Verschlüsseln; der
-- Bucket stellt sicher, dass ein veränderter Client nicht beliebig große Dateien ablegt.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 5243904)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Vault eines Objekts – oder null, wenn der Pfad nicht die Form vault/aufgabe/anhang hat.
-- Null lässt jede Policy scheitern, weil `is_vault_member(null)` falsch ist.
create or replace function public.attachment_vault(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if array_length(v_parts, 1) <> 3 or v_parts[2] = '' or v_parts[3] = '' then
    return null;
  end if;
  return v_parts[1]::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

-- Belegter Platz eines Vaults. `security definer`, weil die Policy auch Objekte zählen
-- muss, die der Nutzer im Moment der Prüfung nicht sehen dürfte. Im Schema `private`, weil
-- sich sonst der belegte Platz fremder Vaults abfragen ließe.
create or replace function private.vault_attachment_bytes(p_vault_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.objects o
  where o.bucket_id = 'attachments'
    and public.attachment_vault(o.name) = p_vault_id;
$$;

revoke execute on function private.vault_attachment_bytes(uuid) from public, anon;
grant execute on function private.vault_attachment_bytes(uuid) to authenticated;

-- 200 MiB je Vault.
create or replace function public.attachment_quota_bytes()
returns bigint
language sql
immutable
set search_path = public
as $$ select 209715200::bigint $$;

-- Vor dem Hochladen fragen, ob es gehen wird. Die Policies setzen dasselbe durch, melden
-- aber nur "verboten" – der Client muss "kein Abo" von "voll" unterscheiden können.
create or replace function public.attachment_upload_status(p_vault_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not private.is_vault_member(p_vault_id) then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;
  if not private.has_active_sync(auth.uid()) then
    return 'entitlement';
  end if;
  if private.vault_attachment_bytes(p_vault_id) >= public.attachment_quota_bytes() then
    return 'quota';
  end if;
  return 'ok';
end;
$$;

-- Wie bei `records`: Lesen darf jedes Mitglied, auch ohne Abo – sonst käme niemand mit
-- abgelaufenem Abo auf einem neuen Gerät an seine Dateien. Hochladen nur mit Abo und
-- unter dem Kontingent. Löschen darf jedes Mitglied: es spart Speicher und kostet nichts.
--
-- Kein Update: ein Anhang ändert sich nie, er bekommt eine neue ID. So kann auch niemand
-- eine vorhandene Datei durch eine andere ersetzen.
--
-- Das Kontingent zählt die neue Datei nicht mit (ihre Größe steht erst nach dem Upload in
-- den Metadaten). Ein Vault kann die Grenze also um höchstens eine Datei überschreiten.
create policy "Anhaenge lesen" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and private.is_vault_member(public.attachment_vault(name)));

create policy "Anhaenge hochladen" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and private.is_vault_member(public.attachment_vault(name))
    and private.has_active_sync(auth.uid())
    and private.vault_attachment_bytes(public.attachment_vault(name)) < public.attachment_quota_bytes()
  );

create policy "Anhaenge loeschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and private.is_vault_member(public.attachment_vault(name)));

-- ===========================================================================
-- 9. Abo-Events (Webhook)
--
-- Die Bedingung "nur vorwärts" steht im `on conflict` selbst, wo sie sich testen lässt –
-- dass PostgREST einen Filter beim Upsert auf das `do update` anwendet, ist nirgends
-- zugesagt. Sonst drehte ein verspätetes, älteres Event (etwa `subscription_updated` nach
-- `subscription_expired`) den Stand zurück.
--
-- Die Konto-ID kommt beim angemeldeten Kauf aus dem Checkout-Link. Gibt es dieses Konto
-- nicht – weil die ID manipuliert ist oder das Konto nach einem Restore fehlt –, wird das
-- Abo ohne Konto gespeichert und gilt über die bestätigte E-Mail-Adresse. Sonst scheiterte
-- jedes Event am Fremdschlüssel, und auch spätere Verlängerungen kämen nie an.
-- ===========================================================================
create or replace function public.apply_subscription_event(
  p_provider_sub_id      text,
  p_user_id              uuid,
  p_email                text,
  p_provider             text,
  p_provider_customer_id text,
  p_status               text,
  p_provider_status      text,
  p_current_period_end   timestamptz,
  p_event_at             timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Ein Konto, das es nicht gibt, behandeln wie einen Kauf ohne Konto: das Abo gilt dann
  -- über die bestätigte Bestell-E-Mail (has_active_sync). Ohne das scheiterte das Event am
  -- Fremdschlüssel, und LemonSqueezy wiederholte es vergeblich.
  if p_user_id is not null and not exists (select 1 from auth.users u where u.id = p_user_id) then
    p_user_id := null;
  end if;

  insert into public.subscriptions as s (
    provider_sub_id, user_id, email, provider, provider_customer_id,
    status, provider_status, current_period_end, event_at, updated_at
  )
  values (
    p_provider_sub_id, p_user_id, p_email, p_provider, p_provider_customer_id,
    p_status, p_provider_status, p_current_period_end, p_event_at, now()
  )
  on conflict (provider_sub_id) do update set
    -- Eine bekannte Zuordnung darf ein Event ohne Konto nicht wieder lösen.
    user_id              = coalesce(excluded.user_id, s.user_id),
    email                = coalesce(excluded.email, s.email),
    provider             = excluded.provider,
    provider_customer_id = coalesce(excluded.provider_customer_id, s.provider_customer_id),
    status               = excluded.status,
    provider_status      = excluded.provider_status,
    current_period_end   = excluded.current_period_end,
    event_at             = excluded.event_at,
    updated_at           = now()
  -- Webhooks kommen doppelt und verdreht. Gleich alt ist ein Duplikat und darf noch einmal
  -- durch; älter ist ein Nachzügler und wird verworfen.
  where s.event_at is null or s.event_at <= excluded.event_at;

  return found;
end;
$$;

comment on function public.apply_subscription_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz) is
  'Schreibt ein LemonSqueezy-Event, ausser es ist aelter als der gespeicherte Stand. Liefert, ob geschrieben wurde.';

-- Nur der Webhook mit dem Service-Key. Sonst schaltete sich jeder Angemeldete selbst frei.
revoke execute on function public.apply_subscription_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_subscription_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz)
  to service_role;

-- ===========================================================================
-- 10. Nutzungszahlen
--
-- Nur Zählwerte, keine einzelnen Konten: der Report-Job braucht nicht mehr, und was er nicht
-- bekommt, kann er auch nicht verlieren. Aufrufbar ausschließlich mit dem Service-Key über
-- /rest/v1/rpc/usage_stats – `security definer`, weil sie `auth.users` liest, und deshalb
-- für anon und authenticated ausdrücklich gesperrt.
-- ===========================================================================
create or replace function public.usage_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with paying as (
    -- Dieselbe Bedingung wie in private.has_active_sync, hier je Abo statt je Konto.
    select s.*
    from public.subscriptions s
    where (
        s.status in ('active', 'past_due')
        and (s.current_period_end is null or s.current_period_end > now())
      )
      or (s.status = 'canceled' and s.current_period_end > now())
  )
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accountsNew30d', (select count(*) from auth.users u where u.created_at > now() - interval '30 days'),
    'vaults', (select count(*) from public.vaults),
    'subscriptionsByStatus', coalesce(
      (select jsonb_object_agg(status, n) from (
        select status, count(*) as n from public.subscriptions group by status
      ) by_status),
      '{}'::jsonb
    ),
    'paying', (select count(*) from paying),
    -- Bezahlt, aber (noch) keinem Konto zuzuordnen: weder User-ID noch ein Konto mit der
    -- bestätigten E-Mail aus der Bestellung. Wer das sieht, hat einen Supportfall vor sich.
    'payingUnassigned', (
      select count(*) from paying p
      where p.user_id is null
        and not exists (
          select 1 from auth.users u
          where lower(u.email) = p.email and u.email_confirmed_at is not null
        )
    ),
    'manualPremium', (select count(*) from public.profiles where plan = 'premium')
  );
$$;

revoke execute on function public.usage_stats() from public, anon, authenticated;
grant execute on function public.usage_stats() to service_role;

-- ===========================================================================
-- 11. API-Tokens für den MCP-Server
--
-- Ein Token besteht aus drei Teilen: `tp1.<id>.<authSecret>.<keySecret>`. Zum Server gehen
-- nur ID und `authSecret`; hier liegt davon nur der SHA-256-Hash. `keySecret` verlässt den
-- Rechner des Nutzers nie – mit ihm ist der Vault-Key verpackt (`wrapped_vault_key`), den
-- der Server deshalb nicht öffnen kann. Die Ende-zu-Ende-Verschlüsselung bleibt, wie sie ist.
--
-- Die API-Funktionen unten sind für `anon` aufrufbar: Das Token selbst ist der Ausweis, ein
-- Supabase-Login gibt es für Skripte nicht. Jede Funktion prüft es zuerst, und die API
-- gehört zum Sync-Abo – ohne aktives Abo liefert sie gar nichts, auch nicht lesend.
--
-- Widerrufen heißt löschen: Mit der Zeile verschwindet auch der verpackte Vault-Key.
-- ===========================================================================
create table public.api_tokens (
  id                uuid primary key,
  user_id           uuid not null references auth.users on delete cascade,
  vault_id          uuid not null references public.vaults on delete cascade,
  name              text not null check (char_length(name) between 1 and 60),
  scope             text not null check (scope in ('read', 'write')),
  -- SHA-256 von `authSecret`, hex. Wer die Tabelle liest, kann sich damit nicht anmelden.
  auth_hash         text not null check (auth_hash ~ '^[0-9a-f]{64}$'),
  -- Envelope `{iv, ct, keyVersion}`: der Vault-Key, verpackt mit einem Schlüssel aus `keySecret`.
  wrapped_vault_key jsonb not null,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz
);

create index api_tokens_user_idx on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;

-- Lesen ja, aber ohne Hash und verpackten Schlüssel. Schreiben nur über die Funktionen.
revoke all on public.api_tokens from public, anon, authenticated;
grant select (id, vault_id, name, scope, created_at, last_used_at) on public.api_tokens to authenticated;

create policy "eigene API-Tokens lesen" on public.api_tokens
  for select to authenticated using (user_id = auth.uid());

-- Anlegen und widerrufen – aus der App, als angemeldeter Nutzer.
create or replace function public.create_api_token(
  p_id uuid,
  p_vault_id uuid,
  p_name text,
  p_scope text,
  p_auth_hash text,
  p_wrapped_vault_key jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = 'TP002';
  end if;
  if not private.is_vault_member(p_vault_id) then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;
  if not private.has_active_sync(auth.uid()) then
    raise exception 'API-Zugriff erfordert ein aktives Abo.' using errcode = 'TP001';
  end if;
  -- Gegen Wildwuchs, nicht aus Sicherheitsgründen: Jedes Token ist ein Zugang mehr.
  if (select count(*) from public.api_tokens t where t.user_id = auth.uid()) >= 10 then
    raise exception 'Höchstens 10 API-Tokens.' using errcode = 'TP003';
  end if;

  insert into public.api_tokens (id, user_id, vault_id, name, scope, auth_hash, wrapped_vault_key)
  values (p_id, auth.uid(), p_vault_id, p_name, p_scope, p_auth_hash, p_wrapped_vault_key);
end;
$$;

create or replace function public.revoke_api_token(p_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.api_tokens t where t.id = p_id and t.user_id = auth.uid() returning 1
  )
  select exists (select 1 from gone);
$$;

revoke execute on function public.create_api_token(uuid, uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.revoke_api_token(uuid) from public, anon;
grant execute on function public.create_api_token(uuid, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.revoke_api_token(uuid) to authenticated;

-- Token prüfen. Liefert den Token, oder bricht mit einem Code ab, den der MCP-Server
-- unterscheiden kann:
--   TP004  Token unbekannt oder widerrufen
--   TP001  kein aktives Abo
--   TP005  nur Lesen erlaubt
create or replace function private.api_token_check(p_token_id uuid, p_secret text, p_write boolean)
returns public.api_tokens
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.api_tokens%rowtype;
begin
  select * into v_token from public.api_tokens t
  where t.id = p_token_id
    and t.auth_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');

  -- Ob die ID existiert, verrät die Meldung nicht.
  if not found then
    raise exception 'API-Token ungültig oder widerrufen.' using errcode = 'TP004';
  end if;
  -- Wer den Vault verlassen hat, verliert auch seine Tokens dafür.
  if not exists (
    select 1 from public.vault_members m
    where m.vault_id = v_token.vault_id and m.user_id = v_token.user_id
  ) then
    raise exception 'API-Token ungültig oder widerrufen.' using errcode = 'TP004';
  end if;
  if not private.has_active_sync(v_token.user_id) then
    raise exception 'API-Zugriff erfordert ein aktives Abo.' using errcode = 'TP001';
  end if;
  if p_write and v_token.scope <> 'write' then
    raise exception 'Dieses API-Token darf nur lesen.' using errcode = 'TP005';
  end if;

  -- Höchstens einmal pro Minute: sonst schriebe jeder Pull eine Zeile.
  if v_token.last_used_at is null or v_token.last_used_at < now() - interval '1 minute' then
    update public.api_tokens set last_used_at = now() where id = v_token.id;
  end if;

  return v_token;
end;
$$;

revoke execute on function private.api_token_check(uuid, text, boolean) from public, anon, authenticated;

-- Die API selbst. Für `anon` freigegeben, denn das Token ist der Ausweis.

/** Was der MCP-Server zum Start braucht: Vault, Schlüsselversion, verpackter Vault-Key. */
create or replace function public.api_session(p_token_id uuid, p_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.api_tokens%rowtype;
begin
  v_token := private.api_token_check(p_token_id, p_secret, false);
  return jsonb_build_object(
    'vaultId', v_token.vault_id,
    'keyVersion', (select (v.keyring->>'keyVersion')::int from public.vaults v where v.id = v_token.vault_id),
    'scope', v_token.scope,
    'name', v_token.name,
    'wrappedVaultKey', v_token.wrapped_vault_key
  );
end;
$$;

create or replace function public.api_pull(p_token_id uuid, p_secret text, p_cursor bigint, p_limit int)
returns table (id uuid, hlc text, iv text, ct text, key_version int, deleted boolean, server_seq bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.api_tokens%rowtype;
begin
  v_token := private.api_token_check(p_token_id, p_secret, false);
  return query
  select r.id, r.hlc, r.iv, r.ct, r.key_version, r.deleted, r.server_seq
  from public.records r
  where r.vault_id = v_token.vault_id and r.server_seq > coalesce(p_cursor, 0)
  order by r.server_seq
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

create or replace function public.api_push(p_token_id uuid, p_secret text, p_records jsonb)
returns table (id uuid, server_seq bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.api_tokens%rowtype;
begin
  v_token := private.api_token_check(p_token_id, p_secret, true);
  return query select * from private.write_records(v_token.vault_id, p_records);
end;
$$;

create or replace function public.api_epoch(p_token_id uuid, p_secret text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.api_token_check(p_token_id, p_secret, false);
  return (select e.epoch from private.sync_epoch e);
end;
$$;

revoke execute on function public.api_session(uuid, text) from public;
revoke execute on function public.api_pull(uuid, text, bigint, int) from public;
revoke execute on function public.api_push(uuid, text, jsonb) from public;
revoke execute on function public.api_epoch(uuid, text) from public;
grant execute on function public.api_session(uuid, text) to anon, authenticated;
grant execute on function public.api_pull(uuid, text, bigint, int) to anon, authenticated;
grant execute on function public.api_push(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.api_epoch(uuid, text) to anon, authenticated;
