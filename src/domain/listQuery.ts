import { addDays, toIsoDate, today } from './dates';
import {
  allStepsDone,
  buildGraph,
  childrenOf,
  isPausedProject,
  isProject,
  nextStepIds,
  PAUSED_PROJECT_STATUSES,
  type TaskGraph,
} from './projects';
import { hasTag, tagKey } from './tags';
import { isOpen, OPEN_STATUSES, type Task, type TaskStatus } from './types';
import { isFollowUpDue } from './waiting';

/**
 * Eine einzige Regel erzeugt die "Next"-Ansicht (Engage) und erfüllt damit
 * gleichzeitig: alle Todos sehen, nur den nächsten offenen Schritt eines Projekts sehen,
 * Projekte selbst nicht in der Aktionsliste haben.
 */

export interface ListFilter {
  /** Welche Status in die Ansicht gehören. */
  statuses?: readonly TaskStatus[];
  /** Kontext-IDs; leer = kein Filter. Eine Aufgabe passt, wenn sie *einen* davon trägt. */
  contexts?: readonly string[];
  /** Kontext-Filter als UND statt ODER verknüpfen. */
  matchAllContexts?: boolean;
  /** Tag-Namen; leer = kein Filter. Wie bei Kontexten genügt *einer* davon. */
  tags?: readonly string[];
  /** Nur Aufgaben mit hoher Priorität. */
  highPriorityOnly?: boolean;
  /** Freitextsuche über Titel, Notizen und Tags; `#wort` sucht nur unter den Tags. */
  search?: string;
  /** Referenzdatum für Defer-Dates; injizierbar, damit Tests nicht von der Uhr abhängen. */
  referenceDate?: string;
  /** Zurückgestellte Aufgaben mitnehmen – das Board zeigt auch, was erst später dran ist. */
  includeDeferred?: boolean;
}

/**
 * Status, die handlungsbereit sind. `inbox` und `waiting` haben eigene Ansichten – Wartendes
 * mit abgelaufener Frist kommt in "Next" trotzdem dazu (siehe `isFollowUpDue`).
 */
export const ENGAGE_STATUSES: readonly TaskStatus[] = ['next', 'scheduled'];

const matchesContexts = (task: Task, filter: ListFilter): boolean => {
  const wanted = filter.contexts ?? [];
  if (wanted.length === 0) return true;
  return filter.matchAllContexts === true
    ? wanted.every((c) => task.contexts.includes(c))
    : wanted.some((c) => task.contexts.includes(c));
};

const matchesPriority = (task: Task, filter: ListFilter): boolean =>
  filter.highPriorityOnly !== true || task.highPriority;

const matchesTags = (task: Task, filter: ListFilter): boolean => {
  const wanted = filter.tags ?? [];
  return wanted.length === 0 || wanted.some((tag) => hasTag(task, tag));
};

/**
 * Jedes Wort muss passen. Ein Wort mit `#` davor sucht nur unter den Tags, als Anfang
 * eines Tag-Namens – `#ste` findet `#steuer` schon beim Tippen.
 */
const matchesSearch = (task: Task, needle: string): boolean => {
  const words = needle.toLowerCase().split(/\s+/).filter((w) => w !== '');
  return words.every((word) => {
    const tags = task.tags.map(tagKey);
    if (word.startsWith('#')) return tags.some((tag) => tag.startsWith(word.slice(1)));
    return (
      task.title.toLowerCase().includes(word) ||
      task.notes.toLowerCase().includes(word) ||
      tags.some((tag) => tag.includes(word))
    );
  });
};

/**
 * Filtert einen bereits gebauten Graphen. Die Reihenfolge ist hier noch unbestimmt –
 * das Sortieren übernimmt `sort.ts`, damit Filter und Sortierung unabhängig testbar sind.
 */
export function engageableTasks(graph: TaskGraph, filter: ListFilter = {}): readonly Task[] {
  const statuses = filter.statuses ?? ENGAGE_STATUSES;
  const ref = filter.referenceDate ?? today();
  // Nur die Next-Ansicht selbst (ohne eigene Statusliste) holt fälliges Nachfassen herein;
  // das Board ordnet ohnehin nach Status ein.
  const followUps = filter.statuses === undefined;
  const stepIds = nextStepIds(graph);
  const search = filter.search ?? '';

  return [...graph.byId.values()].filter((task) => {
    if (!isOpen(task)) return false;
    if (!statuses.includes(task.status) && !(followUps && isFollowUpDue(task, ref))) return false;
    // Zurückgestellt: erscheint erst ab dem Defer-Datum.
    if (filter.includeDeferred !== true && task.deferDate !== null && task.deferDate > ref) return false;
    // Projekte gehören in die Projektliste, nicht in die Aktionsliste – außer alle ihre
    // Schritte sind erledigt: dann ist das Projekt selbst die nächste Aktion.
    if (isProject(graph, task) && !allStepsDone(graph, task)) return false;
    // Unterhalb eines Projekts zählt nur der nächste Schritt; Checklisten-Punkte einer
    // einzelnen Aufgabe (Elternteil ist kein Projekt) bleiben ganz außen vor.
    if (task.parentId !== null && !stepIds.has(task.id)) return false;
    if (!matchesContexts(task, filter)) return false;
    if (!matchesTags(task, filter)) return false;
    if (!matchesPriority(task, filter)) return false;
    return matchesSearch(task, search);
  });
}

/** Bequemer Einstieg, wenn nur die flache Task-Liste vorliegt. */
export function engageableFrom(tasks: readonly Task[], filter: ListFilter = {}): readonly Task[] {
  return engageableTasks(buildGraph(tasks), filter);
}

/**
 * Flache Statusliste ohne Projektregeln – für Inbox und "Wartet". Dort soll nichts
 * verborgen werden: ein unbearbeiteter Eingang muss sichtbar sein, auch wenn er
 * zufällig unter einem Projekt hängt.
 */
export function tasksByStatus(
  graph: TaskGraph,
  statuses: readonly TaskStatus[],
  filter: Pick<ListFilter, 'contexts' | 'matchAllContexts' | 'tags' | 'highPriorityOnly' | 'search'> = {},
): readonly Task[] {
  const search = filter.search ?? '';
  return [...graph.byId.values()].filter(
    (task) =>
      isOpen(task) &&
      statuses.includes(task.status) &&
      matchesContexts(task, filter) &&
      matchesTags(task, filter) &&
      matchesPriority(task, filter) &&
      matchesSearch(task, search),
  );
}

/**
 * Die Ansicht "All": jede offene Aufgabe gleich welchen Status, auch Schritte hinter dem
 * nächsten. Laufende Projekte fehlen – sie haben ihre eigene Ansicht; eines mit lauter
 * erledigten Schritten steht dagegen wie in "Next" als Aufgabe dabei. Ruhende Projekte
 * (Wartet, Terminiert, Irgendwann) stehen dagegen selbst unter ihrem Status, ihre Schritte
 * aber nicht: die sind Brainstorming für später, keine offenen Aufgaben.
 *
 * `statuses` schränkt optional ein; leer heißt wie beim Kontextfilter: alle.
 */
export function allOpenTasks(
  graph: TaskGraph,
  filter: Pick<ListFilter, 'statuses' | 'contexts' | 'matchAllContexts' | 'tags' | 'highPriorityOnly' | 'search'> = {},
): readonly Task[] {
  const wanted = filter.statuses ?? [];
  const statuses = wanted.length === 0 ? OPEN_STATUSES : OPEN_STATUSES.filter((s) => wanted.includes(s));
  return tasksByStatus(graph, statuses, filter).filter((task) => {
    const parent = task.parentId === null ? undefined : graph.byId.get(task.parentId);
    if (parent !== undefined && isPausedProject(graph, parent)) return false;
    return !isProject(graph, task) || allStepsDone(graph, task) || PAUSED_PROJECT_STATUSES.includes(task.status);
  });
}

/**
 * Erledigte Aufgaben für die Ansicht "Erledigt", zuletzt erledigte zuerst.
 * Anders als die übrigen Listen ohne Projektregeln: erledigte Projekte und Schritte
 * erscheinen gleichermaßen, denn hier geht es ums Wiederfinden, nicht ums Tun.
 */
export function doneTasks(graph: TaskGraph, search = ''): readonly Task[] {
  return [...graph.byId.values()]
    .filter((task) => task.status === 'done' && matchesSearch(task, search))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export type CompletionBucket = 'today' | 'week' | 'older';

/** "Diese Woche" heißt die letzten sieben Tage, nicht die Kalenderwoche. */
export function completionBucket(completedAt: number | null, ref: string = today()): CompletionBucket {
  if (completedAt === null) return 'older';
  const day = toIsoDate(new Date(completedAt));
  if (day >= ref) return 'today';
  return day > addDays(ref, -7) ? 'week' : 'older';
}

/** Gruppiert eine bereits sortierte Liste; leere Gruppen fallen weg. */
export function groupByCompletion(
  tasks: readonly Task[],
  ref: string = today(),
): { bucket: CompletionBucket; tasks: Task[] }[] {
  const order: CompletionBucket[] = ['today', 'week', 'older'];
  const groups = new Map<CompletionBucket, Task[]>(order.map((b) => [b, []]));
  for (const task of tasks) groups.get(completionBucket(task.completedAt, ref))!.push(task);
  return order.map((bucket) => ({ bucket, tasks: groups.get(bucket)! })).filter((g) => g.tasks.length > 0);
}

/**
 * Was "Alle löschen" anfassen darf: Löschen nimmt die Schritte mit, also bleibt ein als
 * erledigt markiertes Projekt mit noch offenen Schritten stehen – sonst verschwänden
 * offene Aufgaben ungefragt.
 */
export function bulkDeletable(graph: TaskGraph, tasks: readonly Task[]): readonly Task[] {
  const hasOpenDescendant = (id: string): boolean =>
    childrenOf(graph, id).some((child) => isOpen(child) || hasOpenDescendant(child.id));
  return tasks.filter((task) => !hasOpenDescendant(task.id));
}
