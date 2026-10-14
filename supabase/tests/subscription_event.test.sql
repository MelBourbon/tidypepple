-- Prüft public.apply_subscription_event().

\set ON_ERROR_STOP on

do $$
declare
  sig text := 'public.apply_subscription_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz)';
begin
  assert not has_function_privilege('anon', sig, 'execute'), 'anon darf keine Abos schreiben';
  assert not has_function_privilege('authenticated', sig, 'execute'), 'authenticated darf keine Abos schreiben';
  assert has_function_privilege('service_role', sig, 'execute'), 'der Webhook muss Abos schreiben duerfen';
  raise notice 'apply_subscription_event: nur mit Service-Key - bestanden';
end $$;

do $$
declare
  kunde uuid := 'b0000000-0000-4000-8000-000000000001';
  applied boolean;
  row public.subscriptions%rowtype;
begin
  insert into auth.users (id, email) values (kunde, 'kunde@example.com');
  set local role service_role;

  applied := public.apply_subscription_event('sub_ev', kunde, 'kunde@example.com', 'lemonsqueezy', 'c1',
    'active', 'active', now() + interval '30 days', '2026-01-01T10:00:00Z');
  assert applied, 'Erstes Event muss geschrieben werden';

  applied := public.apply_subscription_event('sub_ev', null, null, 'lemonsqueezy', null,
    'canceled', 'expired', now() - interval '1 day', '2026-01-03T10:00:00Z');
  assert applied, 'Neueres Event muss geschrieben werden';

  -- Nachzügler: älter als der gespeicherte Stand.
  applied := public.apply_subscription_event('sub_ev', kunde, 'kunde@example.com', 'lemonsqueezy', 'c1',
    'active', 'active', now() + interval '30 days', '2026-01-02T10:00:00Z');
  assert not applied, 'Aelteres Event darf nichts schreiben';
  reset role;

  select * into row from public.subscriptions where provider_sub_id = 'sub_ev';
  assert row.status = 'canceled', 'Stand darf nicht zurueckgedreht werden';
  assert row.user_id = kunde, 'Zuordnung zum Konto darf nicht verloren gehen';
  assert row.email = 'kunde@example.com', 'E-Mail darf nicht verloren gehen';
  assert row.provider_customer_id = 'c1', 'Kundennummer darf nicht verloren gehen';

  delete from public.subscriptions where provider_sub_id = 'sub_ev';
  delete from auth.users where id = kunde;
  raise notice 'apply_subscription_event: nur vorwaerts - bestanden';
end $$;

-- Ein Event mit einer Konto-ID, die es nicht gibt, wird ohne Konto gespeichert und
-- gilt über die bestätigte E-Mail – statt am Fremdschlüssel zu scheitern.
do $$
declare
  unbekannt uuid := 'b0000000-0000-4000-8000-0000000000ff';
  kaeufer uuid := 'b0000000-0000-4000-8000-000000000002';
  applied boolean;
  row public.subscriptions%rowtype;
begin
  set local role service_role;
  applied := public.apply_subscription_event('sub_unbekannt', unbekannt, 'kaeufer@example.com', 'lemonsqueezy', 'c2',
    'active', 'active', now() + interval '30 days', '2026-01-01T10:00:00Z');
  reset role;
  assert applied, 'Event mit unbekanntem Konto muss geschrieben werden';

  select * into row from public.subscriptions where provider_sub_id = 'sub_unbekannt';
  assert row.user_id is null, 'Unbekanntes Konto darf nicht gespeichert werden';
  assert row.email = 'kaeufer@example.com', 'Bestell-E-Mail muss erhalten bleiben';

  insert into auth.users (id, email, email_confirmed_at) values (kaeufer, 'kaeufer@example.com', now());
  assert private.has_active_sync(kaeufer), 'Abo muss ueber die bestaetigte E-Mail gelten';

  delete from public.subscriptions where provider_sub_id = 'sub_unbekannt';
  delete from auth.users where id = kaeufer;
  raise notice 'apply_subscription_event: unbekanntes Konto - bestanden';
end $$;
