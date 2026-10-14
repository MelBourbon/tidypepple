import { platform } from '.';
import { androidBridge, REMINDER_BRIDGE_VERSION, type AndroidBridge } from './android';
import type { PendingReminder } from '@/domain/reminders';
import { t } from '@/i18n';

/**
 * Wer Erinnerungen zustellt:
 * - `native`: die Android-Hülle (ab Bridge 2) plant sie mit AlarmManager, auch bei
 *   geschlossener App.
 * - `browser`: Notification-API, nur solange ein Tab offen ist. Ein Server-Push ginge
 *   nur mit Klartext-Zeitpunkten auf dem Server, und der sieht bewusst nichts (E2E).
 * - `outdated-app`: Hülle ohne Erinnerungen, also eine APK vor 2.1.0.
 * - `unsupported`: Browser ohne Notification-API, etwa Safari auf iOS ohne Home-Bildschirm.
 */
export type ReminderSupport = 'native' | 'browser' | 'outdated-app' | 'unsupported';

export type ReminderPermission = 'granted' | 'denied' | 'default';

/** Feuert auf `window`, sobald der Browser Benachrichtigungen erlaubt – der Scheduler plant dann neu. */
export const PERMISSION_GRANTED_EVENT = 'tidypepple:notifications-granted';

let support: Promise<{ kind: ReminderSupport; bridge: AndroidBridge | null }> | undefined;

/** Einmal ermittelt: Die Bridge-Version ändert sich erst mit einer neuen APK, also nach Neustart. */
export function reminderSupport(): Promise<{ kind: ReminderSupport; bridge: AndroidBridge | null }> {
  support ??= (async () => {
    const bridge = platform() === 'android' ? androidBridge() : null;
    if (bridge !== null) {
      try {
        const info = await bridge.info();
        return { kind: info.bridge >= REMINDER_BRIDGE_VERSION ? 'native' : 'outdated-app', bridge };
      } catch {
        return { kind: 'outdated-app', bridge: null };
      }
    }
    return { kind: typeof Notification === 'undefined' ? 'unsupported' : 'browser', bridge: null };
  })();
  return support;
}

/**
 * Fragt nach der Erlaubnis, sobald jemand eine Erinnerung setzt – nicht beim Start, sonst
 * wäre es eine Frage ohne Anlass. Ein abgelehntes Fragen ist kein Fehler, nur „denied“.
 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  const { kind, bridge } = await reminderSupport();
  if (kind === 'native' && bridge !== null) {
    try {
      return await bridge.notificationPermission();
    } catch {
      return 'denied';
    }
  }
  if (kind !== 'browser') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') window.dispatchEvent(new Event(PERMISSION_GRANTED_EVENT));
    return result;
  } catch {
    return 'denied';
  }
}

/** Nachricht vom Service Worker nach einem Klick auf die Benachrichtigung (notification-click.js). */
export const OPEN_TASK_MESSAGE = 'tidypepple:open-task';

/**
 * Zeigt eine Erinnerung im Browser. Über den Service Worker, weil Chrome auf Android
 * `new Notification()` gar nicht kennt; ohne aktiven Worker (Entwicklung) über den
 * Konstruktor.
 */
export async function showBrowserReminder(reminder: PendingReminder, onOpen: (id: string) => void): Promise<void> {
  const options: NotificationOptions = {
    body: t.task.reminder,
    tag: `reminder-${reminder.id}`,
    icon: '/icon-192.png',
    data: { taskId: reminder.id },
  };
  const registration =
    'serviceWorker' in navigator && navigator.serviceWorker.controller !== null
      ? await navigator.serviceWorker.getRegistration()
      : undefined;
  if (registration !== undefined) {
    await registration.showNotification(reminder.title, options);
    return;
  }
  const notification = new Notification(reminder.title, options);
  notification.onclick = () => {
    window.focus();
    onOpen(reminder.id);
    notification.close();
  };
}
