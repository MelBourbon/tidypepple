-- TidyPepple – Sync ohne Abo für eigene Installationen.
--
-- Der bezahlte Sync gehört zum gehosteten Dienst, nicht zur App. Wer TidyPepple selbst
-- betreibt, schaltet die Abo-Pflicht einmal ab, statt jedes Konto per `plan = 'premium'`
-- freizuschalten:
--
--   update private.settings set require_subscription = false;
--
-- Der Schalter sitzt in `has_active_sync`, der einzigen Quelle der Berechtigung. Damit gilt
-- er überall zugleich: RLS auf `records`, `push_records`, Anhänge und API-Tokens. Ohne Abo-Pflicht
-- braucht es weder LemonSqueezy noch die Webhook-Function noch eine Checkout-Adresse.
--
-- Standard ist `true`: Ein bestehendes Projekt verhält sich nach dieser Migration genau wie
-- vorher.

create table private.settings (
  only_row             boolean primary key default true check (only_row),
  require_subscription boolean not null default true
);

insert into private.settings default values;

-- Nur der Datenbankeigentümer (SQL-Editor). `private` ist für PostgREST unsichtbar, und
-- ohne Grant kommt auch `has_active_sync` nur über `security definer` an den Wert.
revoke all on private.settings from public, anon, authenticated;

-- Unverändert gegenüber 0001 bis auf die erste Bedingung.
create or replace function private.has_active_sync(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Eigene Installation ohne Abo-Pflicht: jedes Konto darf synchronisieren.
    (
      p_user_id is not null
      and not (select s.require_subscription from private.settings s)
    )
    -- Manuelle Freischaltung für Rückerstattungen, Testkonten und Freunde. Ohne diesen
    -- Weg wäre jede Sonderbehandlung ein Eingriff beim Zahlungsanbieter.
    or exists (
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
