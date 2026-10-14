import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, getMeta, setMeta } from './db';
import { allOpenTasks, engageableTasks, type ListFilter } from '@/domain/listQuery';
import { allProjects, buildGraph, type TaskGraph } from '@/domain/projects';
import { allTags } from '@/domain/tags';
import { sortByListOrder, sortTasks, type SortSpec } from '@/domain/sort';
import { isLive, type Context, type Task } from '@/domain/types';

/**
 * Alle Ansichten arbeiten auf der kompletten Task-Menge im Speicher. Bei GTD-Größenordnungen
 * (Tausende Aufgaben) ist das schneller als mehrere Index-Queries – und es hält die
 * Projekt-Regeln an genau einer Stelle, statt sie je Ansicht in Queries nachzubauen.
 */

const EMPTY: readonly Task[] = [];

export function useAllTasks(): readonly Task[] {
  return useLiveQuery(() => db.tasks.toArray(), [], EMPTY as Task[]);
}

/** Alle Tags lebender Aufgaben, alphabetisch. */
export function useTags(): readonly string[] {
  const tasks = useAllTasks();
  return useMemo(() => allTags(tasks), [tasks]);
}

export function useContexts(): readonly Context[] {
  const rows = useLiveQuery(() => db.contexts.orderBy('order').toArray(), [], [] as Context[]);
  return useMemo(() => rows.filter(isLive), [rows]);
}

export function useGraph(): TaskGraph {
  const tasks = useAllTasks();
  return useMemo(() => buildGraph(tasks), [tasks]);
}

export function useTask(id: string | undefined): Task | undefined {
  return useLiveQuery(() => (id === undefined ? undefined : db.tasks.get(id)), [id], undefined);
}

/**
 * `next` ist die Engage-Liste nach GTD-Regeln, `all` jede offene Aufgabe außer Projekten
 * (siehe `allOpenTasks`).
 * Beide sortiert nach Nutzerwahl.
 */
export function useTaskList(filter: ListFilter, sort: SortSpec, scope: 'next' | 'all' = 'next'): readonly Task[] {
  const graph = useGraph();
  const contexts = useContexts();
  return useMemo(
    () =>
      sortTasks(
        scope === 'next' ? engageableTasks(graph, filter) : allOpenTasks(graph, filter),
        sort,
        contexts,
      ),
    [graph, filter, sort, contexts, scope],
  );
}

export function useProjects(): readonly Task[] {
  const graph = useGraph();
  return useMemo(() => sortByListOrder(allProjects(graph)), [graph]);
}

export function useOutboxCount(): number {
  return useLiveQuery(() => db.outbox.count(), [], 0);
}

/**
 * Eine in IndexedDB persistierte Einstellung (Sortierung, Kontextfilter).
 * Recognition over Recall: die zuletzt gewählte Ansicht ist beim nächsten Start noch da.
 */
export function useSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const stored = useLiveQuery(() => getMeta<T>(key), [key], undefined);
  const value = stored === undefined ? fallback : stored;
  return [value, (next: T) => void setMeta(key, next)];
}
