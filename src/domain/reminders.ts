import { isOpen, type Task } from './types';

/**
 * Erinnerungen (Issue: Benachrichtigungen nur auf Wunsch). Eine Aufgabe erinnert genau dann,
 * wenn jemand `reminderAt` gesetzt hat – nie automatisch zur Fälligkeit.
 *
 * Wer klingelt, entscheidet die Plattform: die Android-Hülle plant die ganze Liste nativ
 * (`reminder.sync`), der Browser nur, solange ein Tab offen ist. Siehe ReminderScheduler.
 */

export interface PendingReminder {
  id: string;
  /** Lokale Zeit 'YYYY-MM-DDTHH:mm', wie gespeichert – die Hülle rechnet selbst um. */
  at: string;
  title: string;
}

/**
 * Wie lange der Browser eine verpasste Erinnerung noch nachholt – etwa wenn der Tab gerade
 * schlief. Länger her wäre keine Erinnerung mehr, sondern Lärm. Die Hülle bekommt nur
 * künftige Erinnerungen; verspätete Alarme holt Android selbst nach.
 */
export const GRACE_MS = 10 * 60_000;

/** Lokale Zeit 'YYYY-MM-DDTHH:mm' in ms, `NaN` bei kaputtem Wert. */
export function reminderTime(at: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(at);
  if (match === null) return Number.NaN;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Offene Aufgaben mit einer Erinnerung ab `from` (ms), nach Zeit sortiert. */
export function pendingReminders(tasks: readonly Task[], from: number): PendingReminder[] {
  return tasks
    .filter((task): task is Task & { reminderAt: string } => task.reminderAt !== null && isOpen(task))
    .map((task) => ({ task, time: reminderTime(task.reminderAt) }))
    .filter(({ time }) => time >= from)
    .sort((a, b) => a.time - b.time || a.task.id.localeCompare(b.task.id))
    .map(({ task }) => ({ id: task.id, at: task.reminderAt, title: task.title }));
}

/** Steht die Erinnerung noch aus? Für die Glocke in der Liste. */
export function hasPendingReminder(task: Task, now: number): boolean {
  return task.reminderAt !== null && reminderTime(task.reminderAt) >= now;
}
