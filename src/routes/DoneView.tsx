import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TaskList, type TaskSection } from '@/components/TaskList';
import { useTaskActions } from '@/components/useTaskActions';
import { useContexts, useGraph } from '@/data/hooks';
import { bulkDeletable, doneTasks, groupByCompletion } from '@/domain/listQuery';
import { t } from '@/i18n';

/**
 * Erledigte Aufgaben wiederfinden, wieder öffnen oder endgültig löschen.
 * Kein Platz in der Bottom-Nav – erreichbar über den Kopf von "All".
 *
 * Wie überall ohne Bestätigungsdialog: Löschen zeigt einen Undo-Toast.
 */
export function DoneView(): React.ReactNode {
  const graph = useGraph();
  const contexts = useContexts();
  const { remove, removeMany } = useTaskActions();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const tasks = useMemo(() => doneTasks(graph, search), [graph, search]);
  const deletable = useMemo(() => bulkDeletable(graph, tasks), [graph, tasks]);

  const sections = useMemo<TaskSection[]>(
    () =>
      groupByCompletion(tasks).map((group) => ({
        key: group.bucket,
        title: t.done.sections[group.bucket],
        tasks: group.tasks,
        collapsed: collapsed.includes(group.bucket),
      })),
    [tasks, collapsed],
  );

  const toggleSection = (key: string): void =>
    setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);

  return (
    <>
      <PageHeader
        title={t.done.title}
        subtitle={t.list.count(tasks.length)}
        actions={
          deletable.length > 0 && (
            <button
              type="button"
              onClick={() => void removeMany(deletable)}
              className="h-8 rounded-md border border-line bg-surface px-3 text-xs text-muted transition-colors hover:border-danger-line hover:bg-danger-soft hover:text-danger"
            >
              {t.done.deleteAll}
            </button>
          )
        }
      />
      <div className="px-4 pb-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.list.searchPlaceholder}
          aria-label={t.list.searchPlaceholder}
          className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-subtle hover:border-line-strong focus:border-accent"
        />
      </div>
      {tasks.length === 0 ? (
        <EmptyState
          title={search !== '' ? t.empty.search : t.empty.done}
          hint={search === '' ? t.empty.doneHint : undefined}
        />
      ) : (
        <TaskList
          tasks={tasks}
          contexts={contexts}
          graph={graph}
          sections={sections}
          onToggleSection={toggleSection}
          onDelete={(task) => void remove(task)}
        />
      )}
    </>
  );
}
