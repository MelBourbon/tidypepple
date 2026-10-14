import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { FilterBar } from '@/components/FilterBar';
import { PageHeader } from '@/components/PageHeader';
import { SortMenu } from '@/components/SortMenu';
import { TaskList, type TaskSection } from '@/components/TaskList';
import { META_KEYS } from '@/data/db';
import { useContexts, useGraph, useSetting, useTags, useTaskList } from '@/data/hooks';
import type { ListFilter } from '@/domain/listQuery';
import { tagKey } from '@/domain/tags';
import { DEFAULT_SORT, groupByContext, groupByStatus, type SortSpec } from '@/domain/sort';
import type { TaskStatus } from '@/domain/types';
import { t } from '@/i18n';

/** Schlüssel des Abschnitts "Ohne Kontext" in der Liste eingeklappter Abschnitte. */
const NO_CONTEXT = '∅';

/** Je Ansicht eigene Einstellungen, damit "All" nicht die Sortierung von "Next" verstellt. */
const SCOPES = {
  next: {
    title: t.list.title,
    empty: t.empty.list,
    hint: t.empty.listHint,
    defaultSort: DEFAULT_SORT,
    keys: {
      sort: META_KEYS.sort,
      contextFilter: META_KEYS.contextFilter,
      tagFilter: META_KEYS.tagFilter,
      priorityFilter: META_KEYS.priorityFilter,
      collapsedContexts: META_KEYS.collapsedContexts,
      collapsedStatuses: META_KEYS.collapsedStatuses,
    },
  },
  all: {
    title: t.list.allTitle,
    empty: t.empty.all,
    hint: t.empty.allHint,
    defaultSort: { key: 'status', dir: 'asc' } satisfies SortSpec,
    keys: {
      sort: META_KEYS.allSort,
      contextFilter: META_KEYS.allContextFilter,
      tagFilter: META_KEYS.allTagFilter,
      priorityFilter: META_KEYS.allPriorityFilter,
      collapsedContexts: META_KEYS.allCollapsedContexts,
      collapsedStatuses: META_KEYS.allCollapsedStatuses,
    },
  },
} as const;

/**
 * `next` ist die Engage-Liste: alles, was jetzt tatsächlich getan werden kann. Projekte
 * erscheinen dort nie selbst – nur ihre nächsten Schritte (siehe `engageableTasks`).
 *
 * `all` zeigt jede offene Aufgabe gleich welchen Status – auch was wartet, irgendwann dran
 * ist oder als späterer Projektschritt ansteht. Laufende Projekte fehlen, sie haben ihre
 * eigene Ansicht; ruhende stehen gekennzeichnet unter ihrem Status, ohne ihre Schritte.
 * Standardmäßig nach Status in Abschnitten.
 */
export function ListView({ scope }: { scope: keyof typeof SCOPES }): React.ReactNode {
  const { title, empty, hint, defaultSort, keys } = SCOPES[scope];
  const [sort, setSort] = useSetting<SortSpec>(keys.sort, defaultSort);
  const [activeContexts, setActiveContexts] = useSetting<string[]>(keys.contextFilter, []);
  const [storedTags, setActiveTags] = useSetting<string[]>(keys.tagFilter, []);
  const [highPriorityOnly, setHighPriorityOnly] = useSetting<boolean>(keys.priorityFilter, false);
  const [collapsedContexts, setCollapsedContexts] = useSetting<string[]>(keys.collapsedContexts, []);
  const [collapsedStatuses, setCollapsedStatuses] = useSetting<string[]>(keys.collapsedStatuses, []);
  // Nur "All" filtert nach Status; "Next" ist per Definition auf Handlungsbereites beschränkt.
  const [statusFilter, setStatusFilter] = useSetting<TaskStatus[]>(META_KEYS.allStatusFilter, []);
  const statuses = scope === 'all' ? statusFilter : undefined;
  const [search, setSearch] = useState('');

  const contexts = useContexts();
  const graph = useGraph();
  const tags = useTags();
  // Ein Tag verschwindet mit seiner letzten Aufgabe. Bliebe er im Filter, wäre die Liste
  // leer, ohne dass ein Chip den Grund zeigt – also nur filtern, was es noch gibt.
  const activeTags = useMemo(
    () => tags.filter((tag) => storedTags.some((s) => tagKey(s) === tagKey(tag))),
    [tags, storedTags],
  );

  const filter = useMemo<ListFilter>(
    () => ({ ...(statuses && { statuses }), contexts: activeContexts, tags: activeTags, highPriorityOnly, search }),
    [statuses, activeContexts, activeTags, highPriorityOnly, search],
  );
  const tasks = useTaskList(filter, sort, scope);

  // Nach Kontext oder Status sortiert bekommt jede Gruppe einen
  // einklappbaren Abschnitt. Beide merken sich getrennt, was eingeklappt ist.
  const sections = useMemo<TaskSection[] | undefined>(() => {
    if (sort.key === 'status') {
      return groupByStatus(tasks).map((group) => ({
        key: group.status,
        title: t.status[group.status],
        tasks: group.tasks,
        collapsed: collapsedStatuses.includes(group.status),
      }));
    }
    if (sort.key !== 'context') return undefined;
    return groupByContext(tasks, contexts).map((group) => {
      const key = group.contextId ?? NO_CONTEXT;
      const name = contexts.find((c) => c.id === group.contextId)?.name;
      return {
        key,
        title: name === undefined ? t.list.noContext : `@${name}`,
        tasks: group.tasks,
        collapsed: collapsedContexts.includes(key),
      };
    });
  }, [sort.key, tasks, contexts, collapsedContexts, collapsedStatuses]);

  const toggleIn = <T,>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const toggleSection = (key: string): void =>
    sort.key === 'status'
      ? setCollapsedStatuses(toggleIn(collapsedStatuses, key))
      : setCollapsedContexts(toggleIn(collapsedContexts, key));

  return (
    <>
      <PageHeader
        title={title}
        subtitle={t.list.count(tasks.length)}
        actions={
          <>
            <SortMenu value={sort} onChange={setSort} />
            {/* Erledigtes hat keinen Platz in der Bottom-Nav; von "All" ist es ein Schritt. */}
            {scope === 'all' && (
              <Link
                to="/done"
                aria-label={t.nav.done}
                title={t.nav.done}
                className="flex size-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {/* Lucide „circle-check", ISC-Lizenz */}
                <svg
                  viewBox="0 0 24 24"
                  className="size-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </Link>
            )}
          </>
        }
      />
      <FilterBar
        contexts={contexts}
        activeContexts={activeContexts}
        onContextsChange={setActiveContexts}
        tags={tags}
        activeTags={activeTags}
        onTagsChange={setActiveTags}
        highPriorityOnly={highPriorityOnly}
        onToggleHighPriority={() => setHighPriorityOnly(!highPriorityOnly)}
        search={search}
        onSearch={setSearch}
        {...(scope === 'all' && { statusFilter: { selected: statusFilter, onChange: setStatusFilter } })}
      />
      {tasks.length === 0 ? (
        <EmptyState
          title={
            search !== ''
              ? t.empty.search
              : highPriorityOnly
                ? t.empty.highPriority
                : (statuses?.length ?? 0) > 0
                  ? t.empty.status
                  : activeTags.length > 0
                    ? t.empty.tag
                    : empty
          }
          hint={
            search === '' && !highPriorityOnly && (statuses?.length ?? 0) === 0 && activeTags.length === 0
              ? hint
              : undefined
          }
        />
      ) : (
        <TaskList
          tasks={tasks}
          contexts={contexts}
          graph={graph}
          sections={sections}
          onToggleSection={toggleSection}
        />
      )}
    </>
  );
}
