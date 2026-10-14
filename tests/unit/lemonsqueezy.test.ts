import { describe, expect, it } from 'vitest';
import {
  normalizeStatus,
  parseVariantIds,
  parseWebhook,
  verifySignature,
  wantsLoginLink,
} from '../../supabase/functions/_shared/lemonsqueezy';

/**
 * Die Webhook-Logik ist ohne Anbieter prüfbar: Body und Secret sind bekannt, der
 * erwartete HMAC ist berechenbar.
 */

const SECRET = 'signing-secret-aus-dem-dashboard';

const sign = async (body: string, secret = SECRET): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
};

describe('verifySignature', () => {
  const body = JSON.stringify({ meta: { event_name: 'subscription_created' } });

  it('akzeptiert eine gültige Signatur', async () => {
    expect(await verifySignature(body, await sign(body), SECRET)).toBe(true);
  });

  it('lehnt einen manipulierten Body ab', async () => {
    const signature = await sign(body);
    expect(await verifySignature(body + ' ', signature, SECRET)).toBe(false);
  });

  it('lehnt ein falsches Secret ab', async () => {
    expect(await verifySignature(body, await sign(body, 'falsch'), SECRET)).toBe(false);
  });

  it('lehnt fehlende, leere und unsinnige Signaturen ab', async () => {
    expect(await verifySignature(body, null, SECRET)).toBe(false);
    expect(await verifySignature(body, '', SECRET)).toBe(false);
    expect(await verifySignature(body, 'kein-hex!!', SECRET)).toBe(false);
  });

  it('ist unempfindlich gegen Groß-/Kleinschreibung des Hex-Werts', async () => {
    expect(await verifySignature(body, (await sign(body)).toUpperCase(), SECRET)).toBe(true);
  });
});

describe('normalizeStatus', () => {
  it('bildet die LemonSqueezy-Status auf das eigene Vokabular ab', () => {
    expect(normalizeStatus('active')).toBe('active');
    expect(normalizeStatus('on_trial')).toBe('active');
    expect(normalizeStatus('past_due')).toBe('past_due');
    expect(normalizeStatus('unpaid')).toBe('past_due');
    expect(normalizeStatus('paused')).toBe('paused');
    expect(normalizeStatus('cancelled')).toBe('canceled');
    expect(normalizeStatus('expired')).toBe('canceled');
  });

  it('behandelt unbekannte Status als nicht berechtigt, statt zu raten', () => {
    expect(normalizeStatus('irgendwas_neues')).toBe('canceled');
  });
});

describe('parseWebhook', () => {
  const VARIANTS = new Set(['777']);
  const opts = { allowedVariantIds: VARIANTS };
  const parse = (body: Parameters<typeof parseWebhook>[0]) => parseWebhook(body, opts);

  const payload = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
    meta: { event_name: 'subscription_updated', custom_data: { user_id: 'user-1' }, ...meta },
    data: {
      type: 'subscriptions',
      id: '12345',
      attributes: {
        status: 'active',
        variant_id: 777,
        customer_id: 999,
        user_email: 'Kunde@Example.org',
        renews_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-10-01T10:00:00Z',
        ...over,
      },
    },
  });

  it('übersetzt ein Abo-Ereignis vollständig', () => {
    expect(parse(payload())).toEqual({
      event: 'subscription_updated',
      userId: 'user-1',
      email: 'kunde@example.org',
      providerCustomerId: '999',
      providerSubId: '12345',
      status: 'active',
      providerStatus: 'active',
      currentPeriodEnd: '2026-11-01T00:00:00Z',
      eventAt: '2026-10-01T10:00:00Z',
    });
  });

  it('nimmt bei einer Kündigung das Enddatum, nicht das Verlängerungsdatum', () => {
    const result = parse(payload({ status: 'cancelled', ends_at: '2026-10-20T00:00:00Z' }));
    // Sonst verlöre ein gekündigter Kunde sofort die bereits bezahlte Zeit.
    expect(result).toMatchObject({ status: 'canceled', currentPeriodEnd: '2026-10-20T00:00:00Z' });
  });

  it('ordnet einen Kauf ohne Konto über die E-Mail aus der Bestellung zu', () => {
    expect(parse(payload({}, { custom_data: {} }))).toMatchObject({
      userId: null,
      email: 'kunde@example.org',
    });
    expect(parse(payload({}, { custom_data: { user_id: '' } }))).toMatchObject({ userId: null });
    expect(parse(payload({}, { custom_data: undefined }))).toMatchObject({ userId: null });
  });

  it('ignoriert Ereignisse ohne Konto und ohne E-Mail', () => {
    expect(parse(payload({ user_email: undefined }, { custom_data: {} }))).toBeNull();
    expect(parse(payload({ user_email: '  ' }, { custom_data: {} }))).toBeNull();
  });

  it('ignoriert Ereignisse, die das Abo nicht betreffen', () => {
    expect(parse(payload({}, { event_name: 'order_created' }))).toBeNull();
    expect(parse({})).toBeNull();
  });

  it('ignoriert Zahlungs-Events – deren Daten sind eine Rechnung, kein Abo', () => {
    // So sieht `subscription_payment_success` aus: Rechnungsnummer statt Abo-ID, Status
    // der Rechnung. Als Abo gelesen hätte es ein fremdes Abo mit derselben Nummer gekündigt.
    const invoice = {
      meta: { event_name: 'subscription_payment_success', custom_data: { user_id: 'user-1' } },
      data: {
        type: 'subscription-invoices',
        id: '12345',
        attributes: { subscription_id: 999, status: 'paid', user_email: 'kunde@example.org', updated_at: '2026-10-01T10:00:00Z' },
      },
    };
    expect(parse(invoice)).toBeNull();
    expect(parse({ ...invoice, meta: { ...invoice.meta, event_name: 'subscription_payment_failed' } })).toBeNull();
    // Auch unter einem Abo-Event-Namen zählt nur ein Abo-Objekt.
    expect(parse({ ...invoice, meta: { ...invoice.meta, event_name: 'subscription_updated' } })).toBeNull();
  });

  it('ignoriert Abos anderer Varianten und Produkte im Store', () => {
    // Etwa das Abo einer zweiten App im selben Store, oder eine günstigere Variante.
    expect(parse(payload({ variant_id: 888 }))).toBeNull();
    expect(parse(payload({ variant_id: undefined }))).toBeNull();
    expect(parse(payload({ variant_id: '777' }))).not.toBeNull();
    expect(parseWebhook(payload(), { allowedVariantIds: new Set() })).toBeNull();
  });

  it('ignoriert Testmodus-Ereignisse, solange sie nicht ausdrücklich erlaubt sind', () => {
    // Ein Testkauf kostet nichts – im Echtbetrieb darf er keine Berechtigung verschaffen.
    expect(parse(payload({}, { test_mode: true }))).toBeNull();
    expect(parseWebhook(payload({}, { test_mode: true }), { ...opts, allowTestMode: false })).toBeNull();
    expect(parseWebhook(payload({}, { test_mode: true }), { ...opts, allowTestMode: true })).toMatchObject({
      providerSubId: '12345',
    });
    expect(parse(payload({}, { test_mode: false }))).not.toBeNull();
  });
});

describe('parseVariantIds', () => {
  it('liest eine Komma-Liste und verwirft Unbrauchbares', () => {
    expect([...parseVariantIds(' 123, 456 ,,abc')]).toEqual(['123', '456']);
    expect(parseVariantIds(undefined).size).toBe(0);
    expect(parseVariantIds('').size).toBe(0);
  });
});

describe('wantsLoginLink', () => {
  const update = (event: string, userId: string | null, email: string | null = 'kunde@example.org') => ({
    event,
    userId,
    email,
    providerCustomerId: null,
    providerSubId: '1',
    status: 'active' as const,
    providerStatus: 'active',
    currentPeriodEnd: null,
    eventAt: '2026-10-01T10:00:00Z',
  });

  it('schickt nach einem Kauf ohne Konto einen Anmeldelink', () => {
    expect(wantsLoginLink(update('subscription_created', null))).toBe(true);
  });

  it('schickt nichts, wenn schon ein Konto zugeordnet ist', () => {
    expect(wantsLoginLink(update('subscription_created', 'user-1'))).toBe(false);
  });

  it('schickt nur beim Anlegen, nicht bei jeder Verlängerung', () => {
    expect(wantsLoginLink(update('subscription_payment_success', null))).toBe(false);
    expect(wantsLoginLink(update('subscription_updated', null))).toBe(false);
  });
});
