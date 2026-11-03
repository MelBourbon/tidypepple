import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TaskList } from '@/components/TaskList';
import { useContexts, useGraph } from '@/data/hooks';
import { tasksByStatus } from '@/domain/listQuery';
import { sortTasks } from '@/domain/sort';
import type { TaskStatus } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Eine Ansicht für einen einzelnen Status (heute nur die Inbox). Sie zeigt bewusst *alles*
 * mit diesem Status, ohne Projektregeln.
 */
function StatusView({
  status,
  title,
  empty,
  hint,
  actions,
}: {
  status: TaskStatus;
  title: string;
  empty: string;
  hint: string;
  actions?: (count: number) => React.ReactNode;
}): React.ReactNode {
  const graph = useGraph();
  const contexts = useContexts();
  // Älteste zuerst: was am längsten unbearbeitet liegt, gehört nach oben.
  const tasks = useMemo(
    () => sortTasks(tasksByStatus(graph, [status]), { key: 'created', dir: 'asc' }),
    [graph, status],
  );

  return (
    <>
      <PageHeader title={title} subtitle={t.list.count(tasks.length)} actions={actions?.(tasks.length)} />
      {tasks.length === 0 ? (
        <EmptyState title={empty} hint={hint} />
      ) : (
        <TaskList tasks={tasks} contexts={contexts} graph={graph} />
      )}
    </>
  );
}

export const InboxView = (): React.ReactNode => (
  <StatusView
    status="inbox"
    title={t.nav.inbox}
    empty={t.empty.inbox}
    hint={t.empty.inboxHint}
    actions={(count) =>
      count > 0 && (
        <Link
          to="/inbox/clarify"
          title={t.clarify.startLabel}
          className="flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          {t.clarify.start}
        </Link>
      )
    }
  />
);
