import type { AndroidBridge, AppInfo } from './android';

/**
 * Update-Hinweis für die Android-App zum Direktdownload (Phase 7).
 *
 * Inhalte kommen mit jedem Web-Deploy, eine neue APK braucht es nur für Änderungen an der
 * Hülle. Ob es eine gibt, steht in `version.json` neben den APKs auf der Website; die
 * schreibt `scripts/release.sh` im Android-Repo. Die installierte Version liefert die
 * Bridge (`app.info`).
 *
 * Abgerufen wird von tidypepple.com, also fremder Origin: nginx der Website erlaubt das
 * per CORS, und `connect-src` in deploy/nginx/tidypepple.conf muss die Adresse enthalten.
 */

export const VERSION_URL = 'https://tidypepple.com/android/version.json';
/** Nur Links auf die eigene Website, damit eine manipulierte Datei nirgendwohin locken kann. */
const ALLOWED_URL_PREFIX = 'https://tidypepple.com/';
const TIMEOUT_MS = 10_000;

export interface RemoteVersion {
  versionCode: number;
  versionName: string;
  /** Download-Seite (sprachneutral, nginx leitet weiter). */
  url: string;
  /** Darunter kommt die Hülle mit der aktuellen PWA nicht mehr zurecht. */
  minVersionCode: number;
}

export type UpdateState = 'current' | 'available' | 'required';

export interface AppUpdate {
  state: UpdateState;
  versionCode: number;
  versionName: string;
  url: string;
}

const isCode = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** `version.json` prüfen. Alles, was nicht passt, gilt als „keine Angabe“. */
export function parseVersionJson(value: unknown): RemoteVersion | null {
  if (typeof value !== 'object' || value === null) return null;
  const { versionCode, versionName, url, minVersionCode } = value as Record<string, unknown>;
  if (!isCode(versionCode) || typeof versionName !== 'string' || versionName === '') return null;
  if (typeof url !== 'string' || !url.startsWith(ALLOWED_URL_PREFIX)) return null;
  return {
    versionCode,
    versionName,
    url,
    // Fehlt die Angabe, ist kein Update Pflicht.
    minVersionCode: isCode(minVersionCode) ? minVersionCode : 0,
  };
}

export function compareVersion(installed: Pick<AppInfo, 'versionCode'>, remote: RemoteVersion): AppUpdate {
  const state: UpdateState =
    installed.versionCode < remote.minVersionCode
      ? 'required'
      : installed.versionCode < remote.versionCode
        ? 'available'
        : 'current';
  return { state, versionCode: remote.versionCode, versionName: remote.versionName, url: remote.url };
}

/**
 * Fragt Hülle und Website. `null` bei jedem Fehler (offline, Website kurz weg, kaputte
 * Datei): Ein fehlender Hinweis schadet nicht, ein falscher würde nerven.
 */
export async function checkAppUpdate(
  bridge: Pick<AndroidBridge, 'info'>,
  fetchFn: typeof fetch = fetch,
): Promise<AppUpdate | null> {
  try {
    const [installed, response] = await Promise.all([
      bridge.info(),
      fetchFn(VERSION_URL, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ]);
    if (!response.ok) return null;
    const remote = parseVersionJson(await response.json());
    return remote === null ? null : compareVersion(installed, remote);
  } catch {
    return null;
  }
}
