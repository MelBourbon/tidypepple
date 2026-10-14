import { OPEN_STATUSES, type Context, type Task, type TaskStatus } from './types';

export const SORT_KEYS = ['manual', 'due', 'created', 'context', 'status'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface SortSpec {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_SORT: SortSpec = { key: 'due', dir: 'asc' };

const statusRank = (status: TaskStatus): number => {
  const i = OPEN_STATUSES.indexOf(status);
  return i === -1 ? OPEN_STATUSES.length : i;
};

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Aufgaben ohne Wert (kein Datum, kein Kontext) landen immer am Ende – auch bei `desc`. */
const nullsLast = (compare: (a: Task, b: Task) => number, hasValue: (t: Task) => boolean) => {
  return (a: Task, b: Task): number => {
    const av = hasValue(a);
    const bv = hasValue(b);
    if (av !== bv) return av ? -1 : 1;
    if (!av) return 0;
    return compare(a, b);
  };
};

/**
 * Vergleichsfunktion für eine Sortierung. `contexts` bestimmt die Reihenfolge der
 * Kontexte (nach deren `order`), damit "@Büro vor @Telefon" vom Nutzer steuerbar ist.
 */
export function comparator(spec: SortSpec, contexts: readonly Context[] = []): (a: Task, b: Task) => number {
  const rank = new Map(contexts.map((c, i) => [c.id, i]));
  const contextRank = (t: Task): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const id of t.contexts) best = Math.min(best, rank.get(id) ?? Number.POSITIVE_INFINITY);
    return best;
  };

  const sign = spec.dir === 'desc' ? -1 : 1;
  // Die Richtung gilt nur für den Wertvergleich. Die Partition "ohne Wert nach hinten"
  // liegt außerhalb, damit Aufgaben ohne Datum auch bei absteigender Sortierung unten bleiben.
  const signed = (f: (a: Task, b: Task) => number) => (a: Task, b: Task) => sign * f(a, b);

  let base: (a: Task, b: Task) => number;
  switch (spec.key) {
    case 'manual':
      base = signed((a, b) => cmp(a.order, b.order));
      break;
    case 'due':
      // Am selben Tag steht Wichtiges zuerst – unabhängig von Richtung und Uhrzeit. Über
      // Tage hinweg zählt nur das Datum: Wichtiges von morgen überholt nichts von heute.
      base = nullsLast(
        (a, b) =>
          sign * cmp(a.dueDate!, b.dueDate!) ||
          cmp(Number(b.highPriority), Number(a.highPriority)) ||
          sign * cmp(a.dueTime ?? '99:99', b.dueTime ?? '99:99'),
        (t) => t.dueDate !== null,
      );
      break;
    case 'created':
      base = signed((a, b) => cmp(a.createdAt, b.createdAt));
      break;
    case 'context':
      base = nullsLast(signed((a, b) => cmp(contextRank(a), contextRank(b))), (t) => t.contexts.length > 0);
      break;
    case 'status':
      // Arbeitsreihenfolge wie die Board-Spalten, nicht alphabetisch.
      base = signed((a, b) => cmp(statusRank(a.status), statusRank(b.status)));
      break;
  }

  // `order` und `id` als Tie-Break: gleiche Schlüssel dürfen die Liste beim Neurendern
  // nicht umsortieren.
  return (a, b) => base(a, b) || cmp(a.order, b.order) || cmp(a.id, b.id);
}

export function sortTasks(tasks: readonly Task[], spec: SortSpec, contexts?: readonly Context[]): Task[] {
  return [...tasks].sort(comparator(spec, contexts));
}

export interface TaskGroup {
  /** Kontext-ID oder `null` für "ohne Kontext". */
  contextId: string | null;
  tasks: Task[];
}

/**
 * Teilt eine bereits sortierte Liste in Abschnitte nach Kontext. Eine Aufgabe
 * mit mehreren Kontexten steht nur unter dem obersten – wie im Board. Die Reihenfolge der
 * Abschnitte folgt der Sortierung, Aufgaben ohne (bekannten) Kontext kommen immer zuletzt.
 */
export function groupByContext(tasks: readonly Task[], contexts: readonly Context[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const none: TaskGroup = { contextId: null, tasks: [] };
  for (const task of tasks) {
    const primary = contexts.find((c) => task.contexts.includes(c.id));
    if (primary === undefined) {
      none.tasks.push(task);
      continue;
    }
    let group = groups.get(primary.id);
    if (group === undefined) {
      group = { contextId: primary.id, tasks: [] };
      groups.set(primary.id, group);
    }
    group.tasks.push(task);
  }
  const result = [...groups.values()];
  if (none.tasks.length > 0) result.push(none);
  return result;
}

/**
 * Teilt eine bereits sortierte Liste in Abschnitte nach Status. Die Reihenfolge
 * der Abschnitte folgt der Sortierung, also auch deren Richtung.
 */
export function groupByStatus(tasks: readonly Task[]): { status: TaskStatus; tasks: Task[] }[] {
  const groups = new Map<TaskStatus, Task[]>();
  for (const task of tasks) {
    const group = groups.get(task.status);
    if (group === undefined) groups.set(task.status, [task]);
    else group.push(task);
  }
  return [...groups].map(([status, grouped]) => ({ status, tasks: grouped }));
}
