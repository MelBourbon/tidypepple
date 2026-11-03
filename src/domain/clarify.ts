import type { IsoDate, Task } from './types';

/**
 * Inbox klären: jede Aufgabe einmal in die Hand nehmen und entscheiden, was sie ist – in
 * der Reihenfolge des GTD-Flussdiagramms. Hier stehen die Regeln, die Ansicht ruft sie
 * nur auf. So bleibt testbar, was eine Entscheidung an der Aufgabe ändert und wie sie
 * sich zurücknehmen lässt.
 */

export type ClarifyDecision =
  /** Zwei-Minuten-Regel: gleich erledigt. */
  | { kind: 'done' }
  /** Handlungsbereit, mit den Kontexten, die die Aufgabe danach haben soll. */
  | { kind: 'next'; contexts: readonly string[] }
  /** Delegiert: wartet auf jemanden. */
  | { kind: 'waiting'; waitingFor: string | null }
  /** Später: handlungsbereit erst ab einem Datum. */
  | { kind: 'later'; deferDate: IsoDate }
  /** Mehr als ein Schritt: wird zum Projekt mit einem ersten Schritt. */
  | { kind: 'project'; firstStep: string }
  /** Vielleicht irgendwann. */
  | { kind: 'someday' }
  /** Nicht handlungsrelevant: weg damit. */
  | { kind: 'delete' };

export type ClarifyKind = ClarifyDecision['kind'];

/** Die Felder, die eine Entscheidung ändern kann – und die ein Undo wiederherstellt. */
export type ClarifyFields = Pick<
  Task,
  | 'status'
  | 'contexts'
  | 'waitingFor'
  | 'waitingSince'
  | 'deferDate'
  | 'completedAt'
  | 'pinnedAsProject'
  // Erledigen räumt Fälligkeit und Erinnerung ab (siehe `withStatusStamps`) – ein Undo bringt sie zurück.
  | 'dueDate'
  | 'dueTime'
  | 'reminderAt'
>;

/**
 * Was die Entscheidung an der Aufgabe selbst ändert. `delete` ändert keine Felder (die
 * Aufgabe wird gelöscht), `project` legt zusätzlich den ersten Schritt an.
 *
 * `next` trägt die vollständige Kontextauswahl: Das Panel startet mit den Kontexten vom
 * Erfassen, und was dort abgewählt wird, soll auch weg sein.
 */
export function clarifyPatch(decision: ClarifyDecision): Partial<ClarifyFields> | null {
  switch (decision.kind) {
    case 'done':
      return { status: 'done' };
    case 'next':
      return { status: 'next', contexts: [...new Set(decision.contexts)] };
    case 'waiting': {
      const who = decision.waitingFor?.trim() ?? '';
      return { status: 'waiting', waitingFor: who === '' ? null : who };
    }
    case 'later':
      return { status: 'next', deferDate: decision.deferDate };
    case 'project':
      return { status: 'next', pinnedAsProject: true };
    case 'someday':
      return { status: 'someday' };
    case 'delete':
      return null;
  }
}

/** Der Stand vor der Entscheidung – ein Patch, der genau ihn wiederherstellt. */
export function undoFields(before: Task): ClarifyFields {
  const { status, contexts, waitingFor, waitingSince, deferDate, completedAt, pinnedAsProject, dueDate, dueTime, reminderAt } =
    before;
  return {
    status,
    contexts: [...contexts],
    waitingFor,
    waitingSince,
    deferDate,
    completedAt,
    pinnedAsProject,
    dueDate,
    dueTime,
    reminderAt,
  };
}

/** Ein Projekt braucht einen ersten Schritt, sonst fehlt ihm genau das, was Klären klären soll. */
export function isComplete(decision: ClarifyDecision): boolean {
  if (decision.kind === 'project') return decision.firstStep.trim() !== '';
  return true;
}

/**
 * Die nächste Aufgabe: die älteste, die nicht übersprungen wurde. `inbox` ist der aktuelle
 * Inhalt der Inbox – was entschieden ist, ist nicht mehr darin, was zurückgenommen wurde,
 * steht wieder darin und kommt (als älteste) als Nächstes dran.
 */
export function nextToClarify(inbox: readonly Task[], skipped: ReadonlySet<string>): Task | null {
  let best: Task | null = null;
  for (const task of inbox) {
    if (skipped.has(task.id)) continue;
    if (best === null || task.createdAt < best.createdAt || (task.createdAt === best.createdAt && task.id < best.id)) {
      best = task;
    }
  }
  return best;
}

/** Wie oft welche Entscheidung fiel – für die Zusammenfassung am Ende. In fester Reihenfolge. */
export function summarize(log: readonly ClarifyKind[]): { kind: ClarifyKind; count: number }[] {
  const order: readonly ClarifyKind[] = ['done', 'next', 'waiting', 'later', 'project', 'someday', 'delete'];
  return order.map((kind) => ({ kind, count: log.filter((k) => k === kind).length })).filter((e) => e.count > 0);
}
