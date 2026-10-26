-- TidyPepple – Tabellenrechte ausdrücklich vergeben.
--
-- Supabase vergibt für neue Tabellen in `public` keine Rechte mehr automatisch an `anon`,
-- `authenticated` und `service_role`. In neuen Projekten gilt das von Anfang an, in
-- bestehenden für jede Tabelle, die ab der Umstellung angelegt wird. 0001 und 0002 haben
-- sich auf die automatischen Rechte verlassen: In einem frisch aufgesetzten Projekt
-- (docs/self-hosting.md) scheiterte der Sync an `permission denied`, obwohl die Policies
-- stimmen.
--
-- Deshalb steht hier, was jede Rolle braucht. Die Grants entscheiden, ob eine Tabelle
-- überhaupt erreichbar ist, die Policies weiterhin, welche Zeilen.
--
-- In einem bestehenden Projekt ändert die Migration nichts: Dort haben die Rollen diese
-- Rechte bereits, aus den alten Default-Privilegien sogar mehr. Weggenommen wird hier
-- nichts.
--
-- Ab jetzt gilt: Jede neue Tabelle in `public` bekommt ihre Grants in derselben Migration,
-- in der sie entsteht.

-- `anon` bekommt auf keine Tabelle Rechte. Ohne Anmeldung gibt es nur die API-Funktionen,
-- und die laufen als `security definer`.

-- Lesen, wo eine Policy es erlaubt. Geschrieben wird hier nur über `security definer`-
-- Funktionen (`ensure_vault`, Webhook), die Rechte des Aufrufers spielen dafür keine Rolle.
grant select on public.profiles, public.vaults, public.vault_members, public.subscriptions
  to authenticated;

-- `push_records` und `write_records` laufen als `security invoker`, das Upsert also mit
-- den Rechten des Geräts: Einfügen, Ändern und Lesen (für `on conflict … where` und
-- `returning`), dazu `nextval` auf der Sequence. Lesen braucht auch Realtime.
grant select, insert, update on public.records to authenticated;
grant usage on sequence public.records_seq to authenticated;

-- `api_tokens` vergibt seine Rechte schon in 0001 spaltenweise.

-- Der Health-Check der Webhook-Function liest `subscriptions` mit dem Service-Key.
-- Geschrieben wird über `apply_subscription_event`.
grant select on public.subscriptions to service_role;

-- Diese Funktionen hatten bisher kein ausdrückliches `execute` für `authenticated`; es kam
-- aus den Default-Privilegien oder dem Standardrecht für `public`. Die Umstellung nennt nur
-- Tabellen, ausdrücklich ist es trotzdem besser: Dann hängt der Sync nicht an einer
-- Projekteinstellung.
grant execute on function public.ensure_vault(uuid, jsonb) to authenticated;
grant execute on function public.push_records(uuid, jsonb) to authenticated;
grant execute on function public.attachment_upload_status(uuid) to authenticated;
