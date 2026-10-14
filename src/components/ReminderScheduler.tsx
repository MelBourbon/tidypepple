import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllTasks } from '@/data/hooks';
import { GRACE_MS, pendingReminders, reminderTime } from '@/domain/reminders';
import { OPEN_TASK_MESSAGE, PERMISSION_GRANTED_EVENT, reminderSupport, showBrowserReminder } from '@/platform/notifications';

/** Gegen das setTimeout-Limit (~24,8 Tage) und Uhren, die im Schlaf nachgehen: täglich neu rechnen. */
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
/** Welche Erinnerungen dieses Gerät schon gezeigt hat, `<id>@<reminderAt>`. Pro Gerät, nicht synchronisiert. */
const SHOWN_KEY = 'tidypepple.remindersShown';

function readShown(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeShown(shown: Set<string>): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown]));
  } catch {
    // ohne Speicher erinnert der Browser im Zweifel doppelt – besser als gar nicht
  }
}

/**
 * Plant die Erinnerungen aller Aufgaben, ohne etwas anzuzeigen.
 *
 * In der Android-Hülle geht bei jeder Änderung die ganze Liste per `reminder.sync` hinüber –
 * auch die, die per Sync von einem anderen Gerät kamen. Im Browser läuft ein Timer auf die
 * nächste Erinnerung, solange der Tab offen ist.
 */
export function ReminderScheduler(): null {
  const tasks = useAllTasks();
  const navigate = useNavigate();
  const lastSent = useRef<string | null>(null);

  // Klick auf eine Benachrichtigung bei offener App: der Service Worker meldet sich.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data as { type?: unknown; taskId?: unknown } | null;
      if (data?.type === OPEN_TASK_MESSAGE && typeof data.taskId === 'string') void navigate(`/task/${data.taskId}`);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const runBrowser = (): void => {
      clearTimeout(timer);
      if (!active || Notification.permission !== 'granted') return;
      const now = Date.now();
      const pending = pendingReminders(tasks, now - GRACE_MS);
      const shown = readShown();
      const keys = new Set(pending.map((r) => `${r.id}@${r.at}`));
      // Was nicht mehr ansteht, muss sich niemand merken – so bleibt der Eintrag klein.
      for (const key of shown) if (!keys.has(key)) shown.delete(key);
      for (const reminder of pending) {
        const key = `${reminder.id}@${reminder.at}`;
        if (reminderTime(reminder.at) > now || shown.has(key)) continue;
        shown.add(key);
        void showBrowserReminder(reminder, (id) => void navigate(`/task/${id}`)).catch(() => undefined);
      }
      writeShown(shown);
      const next = pending.map((r) => reminderTime(r.at)).find((time) => time > now);
      if (next !== undefined) timer = setTimeout(runBrowser, Math.min(next - now, MAX_DELAY_MS));
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') runBrowser();
    };

    void reminderSupport().then(({ kind, bridge }) => {
      if (!active) return;
      if (kind === 'native' && bridge !== null) {
        const reminders = pendingReminders(tasks, Date.now());
        const json = JSON.stringify(reminders);
        if (json === lastSent.current) return;
        lastSent.current = json;
        bridge.syncReminders(reminders).catch(() => {
          lastSent.current = null;
        });
      } else if (kind === 'browser') {
        runBrowser();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener(PERMISSION_GRANTED_EVENT, runBrowser);
      }
    });

    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(PERMISSION_GRANTED_EVENT, runBrowser);
    };
  }, [tasks, navigate]);

  return null;
}
