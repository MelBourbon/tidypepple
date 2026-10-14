import type { Session } from '@supabase/supabase-js';

/**
 * Bezahlwege hinter einer Schnittstelle. Die Oberfläche fragt nur „wie kauft man hier?“;
 * ob das eine Checkout-Seite im Browser oder ein Kauf in der App ist, entscheidet
 * `src/billing/index.ts` anhand der Plattform.
 *
 * Die Berechtigung bleibt Sache des Servers (`has_active_sync()`), egal über welchen
 * Anbieter gekauft wurde. Nichts hier schaltet etwas frei.
 */

export type BillingProviderId = 'lemonsqueezy' | 'google_play';

/** `conflict`: Das Abo gehört schon zu einem anderen Konto (nur Google Play). */
export type PurchaseResult = 'ok' | 'cancelled' | 'conflict' | 'error';

export type Checkout =
  /** Gehostete Checkout-Seite in einem neuen Tab. Bewusst ein Link und kein Overlay (CSP). */
  | { kind: 'link'; href: string }
  /** Kauf direkt in der App; danach muss der Server den Kauf bestätigt haben. */
  | { kind: 'in-app'; purchase: () => Promise<PurchaseResult> };

export interface BillingProvider {
  id: BillingProviderId;
  /** „Erst bezahlen, dann anmelden“: das Abo hängt dann an der E-Mail aus der Bestellung. */
  allowsPurchaseWithoutAccount: boolean;
  /** `null`: hier kann gerade nicht gekauft werden (nicht konfiguriert, nicht angemeldet …). */
  checkout: (session: Session | null) => Checkout | null;
}
