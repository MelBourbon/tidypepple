-- Nachbau der Supabase-Umgebung, die die Migrationen voraussetzen.
--
-- Nur für den lokalen Testlauf. In einem echten Supabase-Projekt existiert all das
-- bereits – diese Datei darf dort niemals eingespielt werden.

create extension if not exists pgcrypto;

create schema if not exists auth;

create table auth.users (
  id         uuid primary key,
  email      varchar(255),
  -- Gesetzt, sobald die Adresse nachgewiesen ist (Magic Link, Bestätigungsmail).
  email_confirmed_at timestamptz,
  created_at timestamptz default now()
);

-- Supabase liest die Nutzer-ID aus den JWT-Claims. Für den Test wird der Claim
-- per set_config gesetzt.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$;

-- Rollen wie in Supabase. `authenticated` ist bewusst kein Superuser – sonst würde
-- Postgres RLS gar nicht erst auswerten und der Test wäre wertlos.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  -- Der Service-Key des Report-Jobs (`usage_stats`).
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public, auth to authenticated, anon;

-- Supabase vergibt Rechte über Default-Privilegien: neu angelegte Objekte bekommen sie
-- automatisch. Das muss *vor* den Migrationen stehen, damit ein `revoke` in einer
-- Migration danach auch wirklich wirkt – ein pauschaler Grant hinterher würde es
-- wieder aufheben und den Test wertlos machen.
alter default privileges in schema public grant all on tables to authenticated, anon;
alter default privileges in schema public grant all on sequences to authenticated, anon;
alter default privileges in schema public grant execute on functions to authenticated, anon;

-- Realtime-Publikation, die 0001 erweitert.
create publication supabase_realtime;

-- Supabase Storage, soweit die Anhänge ihn brauchen: Buckets, Objekte mit RLS, und die Metadaten,
-- in denen Storage nach dem Upload die Größe ablegt.
create schema if not exists storage;

create table storage.buckets (
  id              text primary key,
  name            text not null,
  public          boolean default false,
  file_size_limit bigint
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets,
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
