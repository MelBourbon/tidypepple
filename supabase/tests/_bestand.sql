-- Nachbau eines bestehenden Supabase-Projekts: Dort vergeben Default-Privilegien Rechte
-- auf jedes neu angelegte Objekt in `public`. Für neue Projekte hat Supabase das
-- abgeschafft; `run.sh` spielt die Datei deshalb nur in einem der beiden Durchläufe ein,
-- nach `_harness.sql` und vor den Migrationen.
--
-- Vor den Migrationen, damit ein `revoke` in einer Migration danach auch wirklich wirkt –
-- ein pauschaler Grant hinterher würde es wieder aufheben und den Test wertlos machen.
alter default privileges in schema public grant all on tables to authenticated, anon, service_role;
alter default privileges in schema public grant all on sequences to authenticated, anon, service_role;
alter default privileges in schema public grant execute on functions to authenticated, anon, service_role;
