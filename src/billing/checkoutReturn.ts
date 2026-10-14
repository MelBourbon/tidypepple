/**
 * Zurück aus dem LemonSqueezy-Checkout: den Abo-Status gleich neu abfragen, statt auf den
 * nächsten Sync-Lauf oder „Status aktualisieren“ zu warten.
 *
 * Zwei Wege zurück:
 * - LemonSqueezy leitet nach dem Kauf auf `/?checkout=done` (Einstellung im Dashboard). In
 *   der Android-App holt der App Link die App nach vorn und lädt diese Adresse.
 * - Der Checkout lief in einem anderen Tab bzw. im Custom Tab, und man kehrt von Hand zurück.
 *   Dann zählt, dass die Seite wieder sichtbar wird, aber nur kurz nach einem Klick auf „Kaufen“.
 */

const PARAM = 'checkout';
const DONE = 'done';
/** So lange nach dem Klick auf „Kaufen“ gilt das Zurückkommen als Rückkehr aus dem Checkout. */
const RETURN_WINDOW_MS = 30 * 60_000;

/** `search` ohne `checkout=done`, und ob es drin war. */
export function stripCheckoutReturn(search: string): { search: string; returned: boolean } {
  const params = new URLSearchParams(search);
  if (params.get(PARAM) !== DONE) return { search, returned: false };
  params.delete(PARAM);
  const rest = params.toString();
  return { search: rest === '' ? '' : `?${rest}`, returned: true };
}

let returned = false;
let startedAt: number | null = null;

/** Einmal vor dem Router (main.tsx): nimmt den Parameter aus der Adresse und merkt ihn sich. */
export function initCheckoutReturn(): void {
  const result = stripCheckoutReturn(window.location.search);
  if (!result.returned) return;
  returned = true;
  const { pathname, hash } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${result.search}${hash}`);
}

/** `true` genau einmal nach einer Rückkehr über `/?checkout=done`. */
export function consumeCheckoutReturn(): boolean {
  const was = returned;
  returned = false;
  return was;
}

/** Beim Klick auf den Kauf-Link. */
export function markCheckoutStarted(now = Date.now()): void {
  startedAt = now;
}

/** Ruft `callback`, wenn die Seite kurz nach einem Kauf-Klick wieder sichtbar wird. */
export function onReturnFromCheckout(callback: () => void): () => void {
  const listener = (): void => {
    if (document.visibilityState !== 'visible' || startedAt === null) return;
    const recent = Date.now() - startedAt < RETURN_WINDOW_MS;
    startedAt = null;
    if (recent) callback();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
