import type { Platform } from '@/platform';
import { lemonSqueezyBilling } from './lemonsqueezy';
import type { BillingProvider } from './types';

export type { BillingProvider, Checkout, PurchaseResult } from './types';

/** Gehostete Checkout-Seite. Bewusst kein Overlay – siehe docs/billing.md zur CSP. */
const CHECKOUT_BASE = ((): string | null => {
  const url = import.meta.env['VITE_LEMONSQUEEZY_CHECKOUT_URL'];
  return typeof url === 'string' && url !== '' ? url : null;
})();

/** Schalter für den Verkauf über Google Play, standardmäßig aus (siehe .env.example). */
export const PLAY_BILLING_ENABLED = import.meta.env['VITE_PLAY_BILLING'] === 'on';

/**
 * Welcher Bezahlweg gilt:
 * - Browser und Android-App zum Direktdownload (`android`): immer LemonSqueezy,
 *   unabhängig vom Play-Schalter. Die App öffnet den Checkout im Custom Tab.
 * - App aus Google Play (`twa`): nur Google Play, und nur wenn der Schalter an ist und Play
 *   antwortet. Sonst gar kein Kauf – ein Link zu LemonSqueezy wäre in einer Play-App unzulässig.
 */
export function selectBilling(
  platform: Platform,
  play: BillingProvider | null,
  lemonSqueezy: BillingProvider = lemonSqueezyBilling(CHECKOUT_BASE),
): BillingProvider | null {
  if (platform !== 'twa') return lemonSqueezy;
  return play;
}
