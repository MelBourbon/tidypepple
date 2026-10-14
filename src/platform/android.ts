import { BRIDGE_NAME } from '.';
import type { PendingReminder } from '@/domain/reminders';

/**
 * Bridge zur WebView-Hülle (eigenes, nicht öffentliches Repository, `Bridge.kt`). Die Hülle
 * gehört zur gehosteten Version; die Schnittstelle ist hier vollständig beschrieben.
 *
 * Die Hülle stellt `window.TidyPeppleAndroid` nur auf https://app.tidypepple.com bereit.
 * Gesprochen wird JSON: `{ id, type, … }` hin, `{ id, ok, result | error }` zurück. Fehlt
 * das Objekt (Browser, alte WebView), liefert `androidBridge()` `null` und jede Stelle
 * fällt auf das Verhalten im Browser zurück.
 */

/** Was `window.TidyPeppleAndroid` mitbringt (WebViewCompat.addWebMessageListener). */
export interface NativeBridge {
  postMessage: (data: string) => void;
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void;
}

export interface AppInfo {
  versionCode: number;
  versionName: string;
  /** Protokollversion der Bridge. Steigt, wenn Nachrichten dazukommen. */
  bridge: number;
}

export interface BridgeFile {
  name: string;
  mimeType: string;
  content: string | Blob;
}

export interface AndroidBridge {
  info: () => Promise<AppInfo>;
  /** „Speichern unter“. `cancelled`: Dialog ohne Auswahl geschlossen. */
  saveFile: (file: BridgeFile) => Promise<'saved' | 'cancelled'>;
  /** Zeigt eine Datei in einer passenden App an (Anhänge). */
  openFile: (file: BridgeFile) => Promise<void>;
  /** Öffnet eine Adresse im Custom Tab, also im Browser über der App. */
  openExternal: (url: string) => Promise<void>;
  /** Ersetzt alle geplanten Erinnerungen der Hülle durch diese Liste (ab Bridge 2). */
  syncReminders: (reminders: readonly PendingReminder[]) => Promise<void>;
  /** Fragt auf Android 13+ nach der Erlaubnis für Benachrichtigungen (ab Bridge 2). */
  notificationPermission: () => Promise<'granted' | 'denied'>;
  /**
   * Dateien, die eine andere App geteilt hat (ab Bridge 3). Den Token bringt `/share?files=…`;
   * `null`, wenn die Freigabe schon abgeholt ist.
   */
  sharedFiles: (token: string) => Promise<SharedFile[] | null>;
  /** Inhalt einer geteilten Datei, `index` wie in `sharedFiles`. */
  sharedFile: (token: string, index: number) => Promise<Blob>;
  /** Gibt die Kopien der geteilten Dateien in der Hülle frei. */
  sharedDone: () => Promise<void>;
}

export interface SharedFile {
  name: string;
  mimeType: string;
  size: number;
  /** Über der Grenze der Hülle (20 MB): ohne Inhalt. */
  tooLarge: boolean;
}

/** Ab dieser Protokollversion kann die Hülle Erinnerungen planen. */
export const REMINDER_BRIDGE_VERSION = 2;

interface Response {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const isResponse = (value: unknown): value is Response =>
  typeof value === 'object' && value !== null && typeof (value as Response).id === 'number';

/** Binärdaten als Base64, in Stücken: `String.fromCharCode(...bytes)` sprengt sonst den Stack. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function fileMessage(file: BridgeFile): Promise<Record<string, string>> {
  const { name, mimeType, content } = file;
  return typeof content === 'string'
    ? { name, mimeType, content, encoding: 'utf8' }
    : { name, mimeType, content: await toBase64(content), encoding: 'base64' };
}

export function createBridge(native: NativeBridge): AndroidBridge {
  let nextId = 1;
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

  native.addEventListener('message', (event) => {
    let response: unknown;
    try {
      response = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!isResponse(response)) return;
    const waiting = pending.get(response.id);
    if (waiting === undefined) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new Error(response.error ?? 'failed'));
  });

  const call = (type: string, payload: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        native.postMessage(JSON.stringify({ ...payload, id, type }));
      } catch (cause) {
        pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });

  return {
    info: async () => (await call('app.info')) as AppInfo,
    saveFile: async (file) => {
      try {
        await call('file.save', await fileMessage(file));
        return 'saved';
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'cancelled') return 'cancelled';
        throw cause;
      }
    },
    openFile: async (file) => {
      await call('file.open', await fileMessage(file));
    },
    openExternal: async (url) => {
      await call('open.external', { url });
    },
    syncReminders: async (reminders) => {
      await call('reminder.sync', { reminders });
    },
    notificationPermission: async () => {
      const result = (await call('notification.permission')) as { granted?: unknown } | null;
      return result?.granted === true ? 'granted' : 'denied';
    },
    sharedFiles: async (token) => {
      try {
        const result = (await call('share.list', { token })) as { files?: unknown } | null;
        return Array.isArray(result?.files) ? (result.files as SharedFile[]) : [];
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'not-found') return null;
        throw cause;
      }
    },
    sharedFile: async (token, index) => {
      const result = (await call('share.file', { token, index })) as { content?: unknown } | null;
      if (typeof result?.content !== 'string') throw new Error('not-found');
      return fromBase64(result.content, '');
    },
    sharedDone: async () => {
      await call('share.done');
    },
  };
}

let bridge: AndroidBridge | null | undefined;

/** Die Bridge der Hülle, oder `null` im Browser. Einmal erzeugt, damit es nur einen Listener gibt. */
export function androidBridge(): AndroidBridge | null {
  if (bridge !== undefined) return bridge;
  const native = typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>)[BRIDGE_NAME];
  bridge =
    typeof native === 'object' && native !== null && typeof (native as NativeBridge).postMessage === 'function'
      ? createBridge(native as NativeBridge)
      : null;
  return bridge;
}
