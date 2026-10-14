import { toIsoDate, today } from './dates';
import type { IsoDate, Task } from './types';

/**
 * Warten mit Frist. Eine wartende Aufgabe gehört nicht in "Next" – bis ihre
 * Fälligkeit erreicht ist. Ab dem Fälligkeitstag ist Nachfassen die nächste Aktion, und sie
 * erscheint dort mit Hinweis.
 */
export function isFollowUpDue(task: Task, ref: IsoDate = today()): boolean {
  return task.status === 'waiting' && task.dueDate !== null && task.dueDate <= ref;
}

/**
 * Ganze Kalendertage seit Beginn der Wartezeit, `null` ohne Startzeitpunkt (Aufgaben, die
 * schon vor der Frist-Funktion warteten). Kalendertage statt 24-h-Blöcken: gestern Abend ist "1 Tag".
 */
export function waitingDays(waitingSince: number | null, ref: IsoDate = today()): number | null {
  if (waitingSince === null) return null;
  const [y1, m1, d1] = toIsoDate(new Date(waitingSince)).split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = ref.split('-').map(Number) as [number, number, number];
  // UTC rechnet ohne Sommerzeit-Sprünge; die Daten selbst sind schon lokal.
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  return Math.max(0, days);
}
