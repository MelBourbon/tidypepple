import type { Session } from '@supabase/supabase-js';
import type { BillingProvider, Checkout } from './types';

/**
 * Checkout-Adresse. Angemeldet wird das Konto mitgegeben, damit das Abo direkt daran
 * hängt, und die E-Mail vorbelegt. Ohne Anmeldung ("erst bezahlen") bleibt die Adresse
 * nackt: dann ordnet der Webhook das Abo über die E-Mail aus der Bestellung zu.
 */
export function checkoutUrlFor(base: string | null, session: Session | null): string | null {
  if (base === null) return null;
  try {
    const url = new URL(base);
    if (session !== null) {
      url.searchParams.set('checkout[custom][user_id]', session.user.id);
      if (session.user.email !== undefined) url.searchParams.set('checkout[email]', session.user.email);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function lemonSqueezyBilling(base: string | null): BillingProvider {
  return {
    id: 'lemonsqueezy',
    allowsPurchaseWithoutAccount: true,
    checkout: (session): Checkout | null => {
      const href = checkoutUrlFor(base, session);
      return href === null ? null : { kind: 'link', href };
    },
  };
}
