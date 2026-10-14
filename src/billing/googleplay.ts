import type { BillingProvider, Checkout, PurchaseResult } from './types';

/**
 * Google Play Billing in der Android-App (TWA), über die Digital Goods API und die
 * Payment Request API. Beide gibt es nur in einer aus Play installierten App, deren
 * Hülle mit `playBilling` gebaut ist – im Browser fehlt `getDigitalGoodsService`.
 *
 * Gekauft wird immer mit Konto: das `purchaseToken` geht an die Edge Function
 * `play-verify`, die es bei Google prüft, bestätigt (`acknowledge`) und dem
 * angemeldeten Konto zuordnet. Erst danach gilt der Kauf als erledigt.
 */

export const PLAY_BILLING_METHOD = 'https://play.google.com/billing';
/** Abo-Produkt in der Play Console. */
export const PLAY_SUBSCRIPTION_ID = 'sync_monthly';
export const PLAY_PACKAGE_ID = 'net.roeslr.tidypepple';

interface ItemDetails {
  itemId: string;
}

interface PurchaseDetails {
  itemId: string;
  purchaseToken: string;
}

export interface DigitalGoodsService {
  getDetails: (itemIds: string[]) => Promise<ItemDetails[]>;
  listPurchases: () => Promise<PurchaseDetails[]>;
}

type WindowWithDigitalGoods = Window & {
  getDigitalGoodsService?: (serviceProvider: string) => Promise<DigitalGoodsService>;
};

/** Antwort von `play-verify`: `conflict`, wenn das Abo schon zu einem anderen Konto gehört. */
export type VerifyResult = 'ok' | 'conflict' | 'error';
export type VerifyPurchase = (purchaseToken: string) => Promise<VerifyResult>;

/**
 * Verbindet sich mit Play, oder `null`. Gilt erst als verfügbar, wenn Play das Abo-Produkt
 * tatsächlich kennt – eine vorhandene, aber nicht antwortende Schnittstelle zählt nicht.
 */
export async function connectPlay(win: Window = window): Promise<DigitalGoodsService | null> {
  const get = (win as WindowWithDigitalGoods).getDigitalGoodsService;
  if (typeof get !== 'function') return null;
  try {
    const service = await get.call(win, PLAY_BILLING_METHOD);
    const details = await service.getDetails([PLAY_SUBSCRIPTION_ID]);
    return details.some((d) => d.itemId === PLAY_SUBSCRIPTION_ID) ? service : null;
  } catch {
    return null;
  }
}

/** Kaufdialog von Play zeigen und den Kauf vom Server bestätigen lassen. */
export async function purchaseWithPlay(verify: VerifyPurchase): Promise<PurchaseResult> {
  let response: PaymentResponse;
  try {
    const request = new PaymentRequest([{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: PLAY_SUBSCRIPTION_ID } }], {
      // Pflichtfeld der Payment Request API; den echten Preis zeigt Play selbst an.
      total: { label: 'Total', amount: { currency: 'EUR', value: '0' } },
    });
    response = await request.show();
  } catch (cause) {
    // AbortError: Nutzer hat den Dialog geschlossen.
    return cause instanceof DOMException && cause.name === 'AbortError' ? 'cancelled' : 'error';
  }

  const token = (response.details as { purchaseToken?: unknown } | null)?.purchaseToken;
  if (typeof token !== 'string' || token === '') {
    await response.complete('fail').catch(() => undefined);
    return 'error';
  }
  const result = await verify(token).catch((): VerifyResult => 'error');
  await response.complete(result === 'ok' ? 'success' : 'fail').catch(() => undefined);
  return result;
}

/**
 * Bestehende Play-Käufe erneut an den Server melden. Fängt den Fall ab, dass nach dem
 * Kauf die Bestätigung nicht ankam (App geschlossen, Netz weg): Google erstattet
 * unbestätigte Käufe nach drei Tagen automatisch.
 */
export async function restorePlayPurchases(service: DigitalGoodsService, verify: VerifyPurchase): Promise<VerifyResult | null> {
  let purchases: PurchaseDetails[];
  try {
    purchases = await service.listPurchases();
  } catch {
    return 'error';
  }
  let last: VerifyResult | null = null;
  for (const p of purchases) {
    if (p.itemId !== PLAY_SUBSCRIPTION_ID) continue;
    last = await verify(p.purchaseToken).catch((): VerifyResult => 'error');
    if (last === 'ok') return 'ok';
  }
  return last;
}

export function playBilling(verify: VerifyPurchase): BillingProvider {
  return {
    id: 'google_play',
    // Das Token wird serverseitig an ein Konto gebunden – ohne Anmeldung gibt es keins.
    allowsPurchaseWithoutAccount: false,
    checkout: (session): Checkout | null =>
      session === null ? null : { kind: 'in-app', purchase: () => purchaseWithPlay(verify) },
  };
}

/** Abo-Center von Play für dieses Abo. Funktioniert auch aus dem Browser heraus. */
export const playManageUrl = (): string =>
  `https://play.google.com/store/account/subscriptions?sku=${PLAY_SUBSCRIPTION_ID}&package=${PLAY_PACKAGE_ID}`;
