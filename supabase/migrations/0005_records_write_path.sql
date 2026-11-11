-- TidyPepple – Records nur noch über `push_records` schreiben, mit Größengrenzen.
--
-- 1. Ein Schreibweg
--
-- Bisher durften Geräte `records` auch direkt beschreiben (Policies "Records schreiben" und
-- "Records ändern", Grants aus 0003). Damit ließen sich umgehen:
--   - der HLC-Vergleich: ein direktes Update überschreibt einen neueren Stand,
--   - die Sperre je Vault: ohne sie kann ein Pull-Cursor Records überspringen,
--   - die Vergabe von `server_seq`: ein Gerät setzt sie selbst, etwa unter die Cursor der
--     anderen, die den Record dann nie holen.
-- Betroffen war nur der eigene Vault. Für geteilte Vaults (vault_members ist dafür angelegt)
-- wäre es aber ein Mitglied, das die Daten der anderen kaputt schreiben kann.
--
-- Jetzt schreibt nur noch `push_records`, als `security definer`. Die Funktion prüft
-- Mitgliedschaft und Abo selbst, wie bisher.
--
-- 2. Grenzen
--
-- Anhänge haben ein Kontingent (200 MiB je Vault), Records hatten keins. Wer Dateien
-- speichern wollte, ohne zu zahlen oder über das Kontingent hinaus, konnte sie in `ct`
-- packen: eine Zeile ist beliebig groß, ein Vault hat beliebig viele.
--   - je Record höchstens 1 MiB Ciphertext. Eine Aufgabe mit sehr langen Notizen kommt auf
--     einige hundert KiB, mehr ist kein Aufgabentext.
--   - je Vault höchstens `private.settings.record_quota_bytes` (Standard 50 MiB). Zehntausend
--     Aufgaben belegen etwa 10 MiB. Eigene Installationen setzen den Wert im SQL-Editor.
-- Ein Push, der den Vault über die Grenze brächte, scheitert ganz mit TP006. Ein Push, der
-- den belegten Platz nicht vergrößert (etwa Löschungen), geht auch über der Grenze durch –
-- sonst käme ein voller Vault aus eigener Kraft nie wieder darunter.
--
-- 0003 sagte: jede neue Tabelle in `public` bekommt ihre Grants in derselben Migration.
-- Diese legt keine an; `private.vault_usage` ist für PostgREST unsichtbar.

-- ---------------------------------------------------------------------------
-- 1. Ein Schreibweg
-- ---------------------------------------------------------------------------

drop policy if exists "Records schreiben" on public.records;
drop policy if exists "Records ändern" on public.records;

-- `all`, nicht nur insert und update: In bestehenden Projekten haben die Rollen aus den alten
-- Default-Privilegien auch delete und truncate. Ohne Policy liefe delete zwar ins Leere,
-- truncate aber umgeht RLS.
revoke all on public.records from public, anon, authenticated;
grant select on public.records to authenticated;
revoke all on sequence public.records_seq from public, anon, authenticated;

-- `push_records` braucht sie als Definer nicht mehr mit den Rechten des Geräts.
revoke execute on function private.write_records(uuid, jsonb) from public, anon, authenticated;

-- Unverändert gegenüber 0001 bis auf `security definer` und den leeren `search_path`
-- (alles ist voll qualifiziert). `auth.uid()` liest den JWT-Claim der Anfrage, nicht die
-- Rolle – die Prüfungen gelten weiterhin für den Aufrufer.
create or replace function public.push_records(p_vault_id uuid, p_records jsonb)
returns table (id uuid, server_seq bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_vault_member(p_vault_id) then
    raise exception 'Kein Zugriff auf diesen Vault.' using errcode = 'TP002';
  end if;

  if not private.has_active_sync(auth.uid()) then
    raise exception 'Synchronisation erfordert ein aktives Abo.' using errcode = 'TP001';
  end if;

  return query select * from private.write_records(p_vault_id, p_records);
end;
$$;

revoke execute on function public.push_records(uuid, jsonb) from public, anon;
grant execute on function public.push_records(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Grenzen
-- ---------------------------------------------------------------------------

-- `not valid` wie in 0004: geprüft wird jedes neue Schreiben, Altbestand bleibt unangetastet.
alter table public.records
  add constraint records_ct_size check (length(ct) <= 1048576) not valid;
alter table public.records
  add constraint records_iv_size check (length(iv) <= 64) not valid;

alter table private.settings
  add column record_quota_bytes bigint not null default 52428800 check (record_quota_bytes > 0);

-- Belegter Platz je Vault, mitgezählt bei jedem Schreiben. Summieren bei jedem Push hieße,
-- jedes Mal alle Zeilen des Vaults zu lesen.
create table private.vault_usage (
  vault_id     uuid primary key references public.vaults on delete cascade,
  record_bytes bigint not null default 0
);

revoke all on private.vault_usage from public, anon, authenticated;

create or replace function private.track_record_bytes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta bigint;
  v_vault uuid;
begin
  if tg_op = 'DELETE' then
    v_vault := old.vault_id;
    v_delta := -(length(old.ct) + length(old.iv));
  elsif tg_op = 'INSERT' then
    v_vault := new.vault_id;
    v_delta := length(new.ct) + length(new.iv);
  else
    v_vault := new.vault_id;
    v_delta := (length(new.ct) + length(new.iv)) - (length(old.ct) + length(old.iv));
  end if;

  insert into private.vault_usage as u (vault_id, record_bytes)
  values (v_vault, greatest(v_delta, 0))
  on conflict (vault_id) do update set record_bytes = greatest(u.record_bytes + v_delta, 0);

  return null;
end;
$$;

revoke execute on function private.track_record_bytes() from public, anon, authenticated;

create trigger records_track_bytes
  after insert or update of ct, iv or delete on public.records
  for each row execute function private.track_record_bytes();

-- Was schon da ist, einmal zählen.
insert into private.vault_usage (vault_id, record_bytes)
select r.vault_id, sum(length(r.ct) + length(r.iv))
from public.records r
group by r.vault_id
on conflict (vault_id) do update set record_bytes = excluded.record_bytes;

-- Unverändert gegenüber 0001 bis auf die Prüfung des Kontingents am Ende. Die Sperre am
-- Anfang serialisiert auch den Zähler: Zwei Pushes in denselben Vault laufen nacheinander.
create or replace function private.write_records(p_vault_id uuid, p_records jsonb)
returns table (id uuid, server_seq bigint)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_before bigint;
  v_after  bigint;
  v_quota  bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('push_records:' || p_vault_id::text, 0));

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

  -- Bricht den ganzen Push ab, auch was oben schon geschrieben war.
  if v_after > v_quota and v_after > v_before then
    raise exception 'Der Speicher für Aufgaben ist voll.' using errcode = 'TP006';
  end if;
end;
$$;

revoke execute on function private.write_records(uuid, jsonb) from public, anon, authenticated;
