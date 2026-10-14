import type { SyncState } from '@/sync/SyncProvider';
import { platform } from '@/platform';

/**
 * Anonymer Start-Ping für die Nutzungszahlen.
 *
 * Bewusst ohne Geräte-ID und ohne irgendetwas im Browser zu speichern: eine gespeicherte
 * Kennung nur für Statistik bräuchte nach § 25 TDDDG eine Einwilligung. Die App meldet
 * deshalb nur "gestartet", mit Anzeigemodus, Version und Sync-Stufe, aus einer Android-App
 * zusätzlich `p=android` (APK zum Direktdownload) bzw. `p=twa` (Google Play). nginx schreibt das
 * in ein eigenes Log; ein externer Report-Job bildet daraus pro Tag einen Hash mit
 * täglich wechselndem Salz und verwirft die Rohdaten. Ein Gerät ist so nur innerhalb eines
 * Tages wiedererkennbar – danach nicht mehr, auch nicht für uns.
 *
 * Fehler gehen denselben Weg (`e=error`): nur Art und Typ, nie die Meldung.
 */

const BEACON_URL = '/beacon';

export type SyncLevel = 'local' | 'account' | 'sync';

/**
 * Grob genug, dass nichts über ein Konto verraten wird: nur, ob überhaupt eins im Spiel ist
 * und ob gerade synchronisiert wird.
 */
export function syncLevel(state: SyncState): SyncLevel | null {
  switch (state) {
    case 'loading':
      return null;
    case 'unconfigured':
    case 'signed-out':
      return 'local';
    case 'ready':
      return 'sync';
    default:
      return 'account';
  }
}

export function displayMode(): 'standalone' | 'browser' {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone ? 'standalone' : 'browser';
}

/** Wo ein Fehler auffiel: Fehlerseite des Routers, globaler Handler, unbehandelte Promise. */
export type ErrorKind = 'render' | 'uncaught' | 'rejection' | 'startup';

export interface BeaconParams {
  e: 'start' | 'install' | 'error';
  mode: 'standalone' | 'browser';
  v: string;
  s?: SyncLevel;
  /** Nur gesetzt, wenn die App in der Android-Hülle läuft – Web-Pings bleiben wie bisher. */
  p?: 'twa' | 'android';
  /** Nur bei `e=error`: Art des Fehlers. */
  k?: ErrorKind;
  /** Nur bei `e=error`: Fehlertyp wie `TypeError` – nie die Meldung, sie kann Inhalte enthalten. */
  n?: string;
}

export function beaconUrl(params: BeaconParams): string {
  const query = new URLSearchParams({ e: params.e, mode: params.mode, v: params.v });
  if (params.s !== undefined) query.set('s', params.s);
  if (params.p !== undefined) query.set('p', params.p);
  if (params.k !== undefined) query.set('k', params.k);
  if (params.n !== undefined) query.set('n', params.n);
  return `${BEACON_URL}?${query.toString()}`;
}

/**
 * Nur der Typ eines Fehlers, und nur, wenn er wie ein Bezeichner aussieht. Die Meldung bleibt
 * auf dem Gerät: In „Cannot read … of 'Einkaufen'“ stünde sonst der Titel einer Aufgabe.
 */
export function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : 'Unknown';
}

/** Nie blockierend, nie werfend: ein fehlender Ping ist kein Fehler der App. */
function send(url: string): void {
  try {
    if (navigator.sendBeacon(url)) return;
  } catch {
    // weiter mit fetch
  }
  fetch(url, { keepalive: true, cache: 'no-store' }).catch(() => {});
}

const app = (): Pick<BeaconParams, 'p'> => {
  const current = platform();
  return current === 'web' ? {} : { p: current };
};

const enabled = (): boolean => import.meta.env['VITE_BEACON'] === 'on';

let started = false;

/** Einmal pro Programmstart – nicht bei jedem Rendern und nicht nach StrictMode-Doppelaufruf. */
export function pingStart(sync: SyncLevel): void {
  if (!enabled() || started) return;
  started = true;
  send(beaconUrl({ e: 'start', mode: displayMode(), v: __APP_VERSION__, s: sync, ...app() }));
}

/** Höchstens so viele Fehler-Pings je Programmstart – eine Fehlerschleife soll nicht fluten. */
const MAX_ERROR_PINGS = 3;
const reportedErrors = new Set<string>();

/** Meldet einen Fehler anonym: Version, Art und Typ. Gleiche Fehler nur einmal je Start. */
export function reportError(kind: ErrorKind, error: unknown): void {
  if (!enabled()) return;
  const n = errorName(error);
  const key = `${kind}:${n}`;
  if (reportedErrors.has(key) || reportedErrors.size >= MAX_ERROR_PINGS) return;
  reportedErrors.add(key);
  send(beaconUrl({ e: 'error', mode: displayMode(), v: __APP_VERSION__, ...app(), k: kind, n }));
}

/**
 * Fehler, die keine Komponente auffängt: in Event-Handlern, Timern und Promises ohne `catch`.
 * Ohne das erführe niemand davon – Nutzer beschweren sich selten, sie deinstallieren.
 */
export function watchErrors(): void {
  window.addEventListener('error', (event) => {
    // Ladefehler von <img> o. ä. kommen ohne `error` – das sind keine Programmfehler.
    if (event.error !== undefined && event.error !== null) reportError('uncaught', event.error);
  });
  window.addEventListener('unhandledrejection', (event) => reportError('rejection', event.reason));
}

/** Installation kommt selten und nur in Chromium-Browsern an – dann aber immer melden. */
export function watchInstall(): void {
  if (!enabled()) return;
  window.addEventListener('appinstalled', () => {
    send(beaconUrl({ e: 'install', mode: 'standalone', v: __APP_VERSION__ }));
  });
}
