import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { selectBilling } from '@/billing';
import {
  connectPlay,
  playBilling,
  purchaseWithPlay,
  restorePlayPurchases,
  PLAY_SUBSCRIPTION_ID,
  type DigitalGoodsService,
} from '@/billing/googleplay';
import { checkoutUrlFor, lemonSqueezyBilling } from '@/billing/lemonsqueezy';
import { currentSubscription, LEMONSQUEEZY_MANAGE_URL, manageUrl, type SubscriptionRow } from '@/billing/subscription';

const BASE = 'https://tidypepple.lemonsqueezy.com/buy/abc-123';
const session = (email?: string): Session =>
  ({ user: { id: 'user-1', ...(email === undefined ? {} : { email }) } }) as unknown as Session;

describe('checkoutUrlFor', () => {
  it('gibt ohne Anmeldung die nackte Adresse zurück („erst bezahlen“)', () => {
    expect(checkoutUrlFor(BASE, null)).toBe(BASE);
  });

  it('hängt angemeldet Konto und E-Mail an', () => {
    const url = new URL(checkoutUrlFor(BASE, session('a@b.de'))!);
    expect(url.searchParams.get('checkout[custom][user_id]')).toBe('user-1');
    expect(url.searchParams.get('checkout[email]')).toBe('a@b.de');
  });

  it('lässt die E-Mail weg, wenn das Konto keine hat', () => {
    const url = new URL(checkoutUrlFor(BASE, session())!);
    expect(url.searchParams.has('checkout[email]')).toBe(false);
  });

  it('liefert null ohne oder mit kaputter Adresse', () => {
    expect(checkoutUrlFor(null, null)).toBeNull();
    expect(checkoutUrlFor('kein url', null)).toBeNull();
  });
});

describe('lemonSqueezyBilling', () => {
  it('kauft per Link und erlaubt den Kauf ohne Konto', () => {
    const billing = lemonSqueezyBilling(BASE);
    expect(billing.allowsPurchaseWithoutAccount).toBe(true);
    expect(billing.checkout(null)).toEqual({ kind: 'link', href: BASE });
  });

  it('bietet ohne Checkout-Adresse keinen Kauf an', () => {
    expect(lemonSqueezyBilling(null).checkout(null)).toBeNull();
  });
});

describe('selectBilling', () => {
  const lemon = lemonSqueezyBilling(BASE);
  const play = playBilling(async () => 'ok');

  it('nimmt im Browser immer LemonSqueezy, auch wenn Play verfügbar wäre', () => {
    expect(selectBilling('web', null, lemon)).toBe(lemon);
    expect(selectBilling('web', play, lemon)).toBe(lemon);
  });

  it('nimmt in der Android-App zum Direktdownload LemonSqueezy wie im Browser', () => {
    expect(selectBilling('android', null, lemon)).toBe(lemon);
    expect(selectBilling('android', play, lemon)).toBe(lemon);
  });

  it('nimmt in der App aus Google Play nur Play und verlinkt sonst nie auf LemonSqueezy', () => {
    expect(selectBilling('twa', play, lemon)).toBe(play);
    expect(selectBilling('twa', null, lemon)).toBeNull();
  });
});

describe('playBilling', () => {
  it('kauft nur mit Konto, weil das Token an ein Konto gebunden wird', () => {
    const billing = playBilling(async () => 'ok');
    expect(billing.allowsPurchaseWithoutAccount).toBe(false);
    expect(billing.checkout(null)).toBeNull();
    expect(billing.checkout(session('a@b.de'))?.kind).toBe('in-app');
  });
});

describe('connectPlay', () => {
  const winWith = (getDetails: () => Promise<{ itemId: string }[]>): Window =>
    ({ getDigitalGoodsService: async () => ({ getDetails, listPurchases: async () => [] }) }) as unknown as Window;

  it('gibt es im Browser nicht', async () => {
    expect(await connectPlay({} as Window)).toBeNull();
  });

  it('gilt nur, wenn Play das Abo-Produkt kennt', async () => {
    expect(await connectPlay(winWith(async () => [{ itemId: PLAY_SUBSCRIPTION_ID }]))).not.toBeNull();
    expect(await connectPlay(winWith(async () => []))).toBeNull();
    expect(await connectPlay(winWith(() => Promise.reject(new Error('kein Play'))))).toBeNull();
  });
});

describe('purchaseWithPlay', () => {
  const complete = vi.fn(async () => undefined);
  const stubPaymentRequest = (show: () => Promise<unknown>): void => {
    vi.stubGlobal(
      'PaymentRequest',
      class {
        show = show;
      },
    );
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    complete.mockClear();
  });

  it('lässt das Token vom Server bestätigen und schließt den Dialog erst danach', async () => {
    stubPaymentRequest(async () => ({ details: { purchaseToken: 'tok-1' }, complete }));
    const verify = vi.fn(async () => 'ok' as const);
    expect(await purchaseWithPlay(verify)).toBe('ok');
    expect(verify).toHaveBeenCalledWith('tok-1');
    expect(complete).toHaveBeenCalledWith('success');
  });

  it('meldet, wenn das Abo schon einem anderen Konto gehört', async () => {
    stubPaymentRequest(async () => ({ details: { purchaseToken: 'tok-1' }, complete }));
    expect(await purchaseWithPlay(async () => 'conflict')).toBe('conflict');
    expect(complete).toHaveBeenCalledWith('fail');
  });

  it('unterscheidet Abbrechen von einem Fehler', async () => {
    stubPaymentRequest(() => Promise.reject(new DOMException('weg', 'AbortError')));
    expect(await purchaseWithPlay(async () => 'ok')).toBe('cancelled');
    stubPaymentRequest(() => Promise.reject(new Error('kaputt')));
    expect(await purchaseWithPlay(async () => 'ok')).toBe('error');
  });

  it('wertet eine Antwort ohne Token als Fehler', async () => {
    stubPaymentRequest(async () => ({ details: {}, complete }));
    expect(await purchaseWithPlay(async () => 'ok')).toBe('error');
  });
});

describe('restorePlayPurchases', () => {
  const service = (purchases: { itemId: string; purchaseToken: string }[]): DigitalGoodsService => ({
    getDetails: async () => [],
    listPurchases: async () => purchases,
  });

  it('meldet nur Käufe des Abo-Produkts nach', async () => {
    const verify = vi.fn(async () => 'ok' as const);
    const result = await restorePlayPurchases(
      service([
        { itemId: 'etwas_anderes', purchaseToken: 'x' },
        { itemId: PLAY_SUBSCRIPTION_ID, purchaseToken: 'tok-2' },
      ]),
      verify,
    );
    expect(result).toBe('ok');
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('tok-2');
  });

  it('gibt null zurück, wenn es nichts nachzumelden gibt', async () => {
    expect(await restorePlayPurchases(service([]), async () => 'ok')).toBeNull();
  });
});

describe('currentSubscription', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const row = (provider: string, status: string, end: string | null): SubscriptionRow => ({
    provider,
    status,
    current_period_end: end,
  });

  it('zeigt nur Abos, die auch der Server als berechtigt ansieht', () => {
    expect(currentSubscription([row('lemonsqueezy', 'paused', '2026-11-01T00:00:00Z')], now)).toBeNull();
    expect(currentSubscription([row('lemonsqueezy', 'canceled', '2026-09-01T00:00:00Z')], now)).toBeNull();
    expect(currentSubscription([row('lemonsqueezy', 'active', '2026-09-01T00:00:00Z')], now)).toBeNull();
    expect(currentSubscription([row('google_play', 'past_due', '2026-10-10T00:00:00Z')], now)?.provider).toBe('google_play');
  });

  it('kennzeichnet ein gekündigtes Abo mit Enddatum', () => {
    const info = currentSubscription([row('google_play', 'canceled', '2026-10-20T00:00:00Z')], now);
    expect(info).toEqual({ provider: 'google_play', renews: false, until: new Date('2026-10-20T00:00:00Z') });
  });

  it('nimmt bei mehreren Abos das mit der längsten Laufzeit', () => {
    const info = currentSubscription(
      [row('lemonsqueezy', 'active', '2026-10-15T00:00:00Z'), row('google_play', 'active', '2026-11-15T00:00:00Z')],
      now,
    );
    expect(info?.provider).toBe('google_play');
  });
});

describe('manageUrl', () => {
  it('verlinkt das Play-Abo-Center überall, LemonSqueezy aber nicht in der App aus Google Play', () => {
    const play = { provider: 'google_play', renews: true, until: null } as const;
    const lemon = { provider: 'lemonsqueezy', renews: true, until: null } as const;
    expect(manageUrl(play, 'twa')).toContain('package=net.roeslr.tidypepple');
    expect(manageUrl(play, 'web')).toContain('play.google.com');
    expect(manageUrl(lemon, 'web')).toBe(LEMONSQUEEZY_MANAGE_URL);
    expect(manageUrl(lemon, 'android')).toBe(LEMONSQUEEZY_MANAGE_URL);
    expect(manageUrl(lemon, 'twa')).toBeNull();
  });
});
