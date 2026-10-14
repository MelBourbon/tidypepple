import { isLive, isOpen, type Task, type TaskStatus } from './types';

/**
 * Projekte sind kein eigener Typ, sondern eine Eigenschaft: eine Aufgabe mit Schritten
 * *ist* ein Projekt. Dadurch gibt es keine Umwandlung zwischen zwei Entitäten
 * und keinen Zustand, in dem beide Sichten auseinanderlaufen können.
 */

export interface TaskGraph {
  byId: ReadonlyMap<string, Task>;
  /** Kinder je Elternteil, aufsteigend nach `order`. Enthält keine gelöschten Aufgaben. */
  childrenOf: ReadonlyMap<string, readonly Task[]>;
  roots: readonly Task[];
}

export function buildGraph(tasks: readonly Task[]): TaskGraph {
  const byId = new Map<string, Task>();
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];

  for (const t of tasks) {
    if (!isLive(t)) continue;
    byId.set(t.id, t);
  }
  for (const t of byId.values()) {
    // Ein Elternteil, das gelöscht wurde, macht seine Kinder zu Wurzeln – sonst
    // verschwinden sie unerreichbar aus jeder Ansicht.
    if (t.parentId !== null && byId.has(t.parentId)) {
      const list = children.get(t.parentId);
      if (list) list.push(t);
      else children.set(t.parentId, [t]);
    } else {
      roots.push(t);
    }
  }

  const byOrder = (a: Task, b: Task): number => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1);
  for (const list of children.values()) list.sort(byOrder);
  roots.sort(byOrder);

  return { byId, childrenOf: children, roots };
}

export const childrenOf = (graph: TaskGraph, id: string): readonly Task[] => graph.childrenOf.get(id) ?? [];
export const openChildrenOf = (graph: TaskGraph, id: string): readonly Task[] => childrenOf(graph, id).filter(isOpen);

/**
 * Schon ein offener Schritt macht eine Aufgabe zum Projekt. `pinnedAsProject` hält diese
 * Beförderung dauerhaft fest: ein Projekt, dessen Schritte alle erledigt sind, bleibt ein
 * Projekt – es taucht dann selbst in "Next" auf (siehe `allStepsDone`).
 */
export function isProject(graph: TaskGraph, task: Task): boolean {
  return task.pinnedAsProject || openChildrenOf(graph, task.id).length >= 1;
}

/** Schwelle für die automatische Beförderung – siehe `isProject`. */
export function shouldAutoPromote(graph: TaskGraph, task: Task): boolean {
  return !task.pinnedAsProject && childrenOf(graph, task.id).filter(isLive).length >= 1;
}

/**
 * Ein Projekt, dessen Schritte alle erledigt sind: es selbst ist dann die nächste Aktion
 * (abschließen oder neuen Schritt planen) und erscheint wie eine Aufgabe in "Next".
 * Ein Projekt ganz ohne Schritte zählt nicht dazu – ihm fehlt noch die Planung.
 */
export function allStepsDone(graph: TaskGraph, task: Task): boolean {
  return isProject(graph, task) && childrenOf(graph, task.id).length > 0 && openChildrenOf(graph, task.id).length === 0;
}

/**
 * Die nächsten offenen Schritte eines Projekts. `sequential` liefert genau einen,
 * `parallel` alle. Ist ein Schritt selbst ein Projekt (Teilprojekt), wird in dessen
 * Schritte hinabgestiegen – die Liste zeigt immer echte Aktionen. Ein Teilprojekt mit
 * lauter erledigten Schritten ist selbst die Aktion (siehe `allStepsDone`).
 */
export function nextSteps(graph: TaskGraph, project: Task, seen: Set<string> = new Set()): readonly Task[] {
  if (seen.has(project.id)) return []; // Zyklusschutz bei defekten Sync-Daten
  seen.add(project.id);

  const open = openChildrenOf(graph, project.id);
  const candidates = project.projectMode === 'parallel' ? open : open.slice(0, 1);

  return candidates.flatMap((step) =>
    isProject(graph, step) && !allStepsDone(graph, step) ? nextSteps(graph, step, seen) : [step],
  );
}

/**
 * Projektstatus, die ein Projekt ruhen lassen: seine Schritte erscheinen nicht in
 * "Next", auch wenn sie selbst auf "Nächste Aktion" stehen. So lassen sich Projekte schon
 * durchplanen, die erst später anfangen.
 */
export const PAUSED_PROJECT_STATUSES: readonly TaskStatus[] = ['waiting', 'scheduled', 'someday'];

/** Ein Projekt ruht, wenn es selbst oder ein übergeordnetes Projekt einen ruhenden Status hat. */
export function isPausedProject(graph: TaskGraph, project: Task): boolean {
  return [project, ...ancestorsOf(graph, project)].some(
    (t) => PAUSED_PROJECT_STATUSES.includes(t.status) && isProject(graph, t),
  );
}

/** Alle Aufgaben-IDs, die als nächster Schritt eines Projekts auf die Liste gehören. */
export function nextStepIds(graph: TaskGraph): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const task of graph.byId.values()) {
    if (!isProject(graph, task) || isPausedProject(graph, task)) continue;
    for (const step of nextSteps(graph, task)) ids.add(step.id);
  }
  return ids;
}

export function allProjects(graph: TaskGraph): readonly Task[] {
  return [...graph.byId.values()].filter((t) => isProject(graph, t) && isOpen(t));
}

export interface ProjectProgress {
  total: number;
  done: number;
  /** Projekt ohne nächsten Schritt – das klassische Signal für den Weekly Review. */
  stalled: boolean;
  /** Alle Schritte erledigt – das Projekt steht selbst in "Next" (siehe `allStepsDone`). */
  allDone: boolean;
}

export function projectProgress(graph: TaskGraph, project: Task): ProjectProgress {
  const all = childrenOf(graph, project.id);
  const done = all.filter((t) => t.status === 'done').length;
  const allDone = allStepsDone(graph, project);
  return { total: all.length, done, stalled: !allDone && nextSteps(graph, project).length === 0, allDone };
}

/** Kette von der Aufgabe bis zur Wurzel, ohne die Aufgabe selbst (für Breadcrumbs). */
export function ancestorsOf(graph: TaskGraph, task: Task): readonly Task[] {
  const chain: Task[] = [];
  let current = task.parentId === null ? undefined : graph.byId.get(task.parentId);
  while (current && !chain.some((t) => t.id === current!.id)) {
    chain.push(current);
    current = current.parentId === null ? undefined : graph.byId.get(current.parentId);
  }
  return chain.reverse();
}

/** Die Aufgabe und alle ihre Nachkommen – Ziele, unter die sie nicht wandern darf (sonst Kreis). */
export function selfAndDescendantIds(graph: TaskGraph, id: string): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (taskId: string): void => {
    if (ids.has(taskId)) return;
    ids.add(taskId);
    for (const child of childrenOf(graph, taskId)) walk(child.id);
  };
  walk(id);
  return ids;
}

/**
 * Projekte, denen sich die Aufgabe zuordnen lässt – alphabetisch, ohne sie selbst und ihre
 * Schritte. Das aktuelle Elternteil steht immer dabei, auch wenn es (noch) kein Projekt ist,
 * damit die Auswahl die bestehende Zuordnung zeigen kann.
 */
export function projectCandidates(graph: TaskGraph, task: Task): readonly Task[] {
  const excluded = selfAndDescendantIds(graph, task.id);
  const candidates = allProjects(graph).filter((p) => !excluded.has(p.id));
  const parent = task.parentId === null ? undefined : graph.byId.get(task.parentId);
  if (parent !== undefined && !candidates.includes(parent)) candidates.push(parent);
  return candidates.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}
