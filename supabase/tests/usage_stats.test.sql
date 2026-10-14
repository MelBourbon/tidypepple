-- Prüft public.usage_stats(): wer sie aufrufen darf und was sie zählt.

\set ON_ERROR_STOP on

do $$
begin
  assert not has_function_privilege('anon', 'public.usage_stats()', 'execute'),
    'anon darf usage_stats nicht ausfuehren';
  assert not has_function_privilege('authenticated', 'public.usage_stats()', 'execute'),
    'authenticated darf usage_stats nicht ausfuehren';
  assert has_function_privilege('service_role', 'public.usage_stats()', 'execute'),
    'service_role muss usage_stats ausfuehren duerfen';
  raise notice 'usage_stats: nur mit Service-Key - bestanden';
end $$;

-- Gezählt wird relativ zum Ausgangsstand: andere Testdateien teilen sich die Datenbank.
do $$
declare
  before jsonb;
  after jsonb;
  diff int;
begin
  set local role service_role;
  before := public.usage_stats();
  reset role;

  insert into auth.users (id, email, created_at, email_confirmed_at) values
    ('a0000000-0000-4000-8000-000000000001', 'neu@example.com', now(), now()),
    ('a0000000-0000-4000-8000-000000000002', 'alt@example.com', now() - interval '90 days', now()),
    ('a0000000-0000-4000-8000-000000000003', 'gekauft@example.com', now(), now()),
    ('a0000000-0000-4000-8000-000000000004', 'unbestaetigt@example.com', now(), null);
  insert into public.subscriptions (user_id, email, provider_sub_id, status, current_period_end) values
    -- zählt: aktiv
    ('a0000000-0000-4000-8000-000000000001', null, 'sub_us_1', 'active', now() + interval '10 days'),
    -- zählt: gekündigt, bezahlte Zeit läuft noch
    ('a0000000-0000-4000-8000-000000000002', null, 'sub_us_2', 'canceled', now() + interval '3 days'),
    -- zählt nicht: pausiert
    (null, 'pausiert@example.com', 'sub_us_3', 'paused', now() + interval '10 days'),
    -- zählt, ohne Konto: niemand mit dieser Adresse
    (null, 'niemand@example.com', 'sub_us_4', 'active', null),
    -- zählt, zugeordnet über die E-Mail
    (null, 'gekauft@example.com', 'sub_us_5', 'active', null),
    -- zählt, ohne Konto: die Adresse trägt nur ein unbestätigtes Konto
    (null, 'unbestaetigt@example.com', 'sub_us_6', 'active', null);

  set local role service_role;
  after := public.usage_stats();
  reset role;

  diff := (after->>'accounts')::int - (before->>'accounts')::int;
  assert diff = 4, format('accounts: +4 erwartet, war +%s', diff);
  diff := (after->>'accountsNew30d')::int - (before->>'accountsNew30d')::int;
  assert diff = 3, format('accountsNew30d: +3 erwartet, war +%s', diff);
  diff := (after->>'paying')::int - (before->>'paying')::int;
  assert diff = 5, format('paying: +5 erwartet, war +%s', diff);
  diff := (after->>'payingUnassigned')::int - (before->>'payingUnassigned')::int;
  assert diff = 2, format('payingUnassigned: +2 erwartet, war +%s', diff);
  diff := coalesce((after->'subscriptionsByStatus'->>'paused')::int, 0)
        - coalesce((before->'subscriptionsByStatus'->>'paused')::int, 0);
  assert diff = 1, format('paused: +1 erwartet, war +%s', diff);

  delete from public.subscriptions where provider_sub_id like 'sub_us_%';
  delete from auth.users where id::text like 'a0000000-%';
  raise notice 'usage_stats: Zaehlung - bestanden';
end $$;
