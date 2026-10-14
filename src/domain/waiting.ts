import { daysSince, today } from './dates';
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
 * schon vor der Frist-Funktion warteten). Siehe `daysSince`.
 */
export function waitingDays(waitingSince: number | null, ref: IsoDate = today()): number | null {
  return waitingSince === null ? null : daysSince(waitingSince, ref);
}
