/**
 * Läuft die App im Browser oder in einer Android-Hülle?
 *
 * - `android`: die WebView-Hülle zum Direktdownload (eigenes Repository). Sie startet
 *   mit `/?src=android` und stellt `window.TidyPeppleAndroid` bereit (siehe ./android.ts).
 *   Gekauft wird wie im Browser über LemonSqueezy.
 * - `twa`: reserviert für eine spätere Version aus Google Play (Trusted Web Activity mit
 *   `/?src=twa`). Dort gilt nur Google Play Billing.
 *
 * Es gibt nur ein Bundle für alle; die Erkennung passiert zur Laufzeit. Eine TWA erkennt
 * man zusätzlich am Referrer `android-app://<paket>`, den Android beim Start setzt. Das
 * Ergebnis wird in sessionStorage gemerkt, weil die Signale nach der ersten Navigation
 * weg sind. Die WebView-Hülle ist ohnehin an ihrer Bridge erkennbar.
 *
 * Wichtig: Eine Fehlerkennung darf im Browser nie etwas kaputt machen. Alles, was nur in
 * der App funktioniert (Play Billing, die Bridge der WebView-Hülle), prüft zusätzlich
 * selbst, ob die nötige Schnittstelle wirklich da ist.
 */

export type Platform = 'web' | 'twa' | 'android';

export const TWA_PACKAGE_ID = 'net.roeslr.tidypepple';
export const BRIDGE_NAME = 'TidyPeppleAndroid';
const SRC_PARAM = 'src';
const STORAGE_KEY = 'tidypepple.platform';

export interface PlatformSignals {
  search: string;
  referrer: string;
  remembered: string | null;
  /** `window.TidyPeppleAndroid` existiert: nur in der WebView-Hülle, nur auf dem eigenen Origin. */
  bridge: boolean;
}

const isAppPlatform = (value: string | null): value is 'twa' | 'android' => value === 'twa' || value === 'android';

export function detectPlatform({ search, referrer, remembered, bridge }: PlatformSignals): Platform {
  if (bridge) return 'android';
  if (isAppPlatform(remembered)) return remembered;
  const marker = new URLSearchParams(search).get(SRC_PARAM);
  if (isAppPlatform(marker)) return marker;
  if (referrer.startsWith(`android-app://${TWA_PACKAGE_ID}`)) return 'twa';
  return 'web';
}

/** `search` ohne den App-Marker, damit er nicht in Lesezeichen oder geteilten Links landet. */
export function withoutMarker(search: string): string {
  const params = new URLSearchParams(search);
  if (!isAppPlatform(params.get(SRC_PARAM))) return search;
  params.delete(SRC_PARAM);
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}

function readRemembered(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: Platform | null = null;

/**
 * Einmal vor dem Router aufrufen (main.tsx): erkennt die Plattform, merkt sie sich und
 * nimmt den Marker aus der Adresszeile. Andere Parameter wie `capture=1` bleiben stehen.
 */
export function initPlatform(): Platform {
  current = detectPlatform({
    search: window.location.search,
    referrer: document.referrer,
    remembered: readRemembered(),
    bridge: BRIDGE_NAME in window,
  });
  if (current !== 'web') {
    try {
      sessionStorage.setItem(STORAGE_KEY, current);
    } catch {
      // ohne Speicher gilt die Erkennung eben nur für diesen Seitenaufruf
    }
    const search = withoutMarker(window.location.search);
    if (search !== window.location.search) {
      const { pathname, hash } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`);
    }
  }
  return current;
}

export function platform(): Platform {
  return current ?? 'web';
}
