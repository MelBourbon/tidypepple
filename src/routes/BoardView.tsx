import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TaskCard } from '@/components/TaskCard';
import { useTaskActions } from '@/components/useTaskActions';
import { useContexts, useGraph, useSetting } from '@/data/hooks';
import { moveTask, updateTask } from '@/data/repo';
import { addDays, dueBucket, today } from '@/domain/dates';
import { engageableTasks } from '@/domain/listQuery';
import { isProject } from '@/domain/projects';
import { comparator } from '@/domain/sort';
import { OPEN_STATUSES, type Context, type Task, type TaskStatus } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Dieselben Aufgaben wie in der Liste, nur anders gruppiert – inklusive derselben
 * `TaskCard`, damit Fälligkeit und Kontexte im Board nicht fehlen können.
 *
 * Bewusst *keine* eigene Board-Semantik: Ziehen ändert immer ein echtes Feld der Aufgabe
 * (Status, Kontext, Projekt, Datum). Es gibt keinen Zustand, den nur das Board kennt.
 */

type GroupBy = 'status' | 'context' | 'project' | 'due';

interface Column {
  key: string;
  title: string;
  /** Spalten ohne sinnvolle Schreibbedeutung nehmen keine Karten an (z. B. "Überfällig"). */
  droppable: boolean;
}

const BOARD_STATUSES = OPEN_STATUSES;
const NONE = '∅';

function buildColumns(groupBy: GroupBy, contexts: readonly Context[], projects: readonly Task[]): Column[] {
  switch (groupBy) {
    case 'status':
      return BOARD_STATUSES.map((s) => ({ key: s, title: t.status[s], droppable: true }));
    case 'context':
      return [
        ...contexts.map((c) => ({ key: c.id, title: `@${c.name}`, droppable: true })),
        { key: NONE, title: t.board.noContext, droppable: true },
      ];
    case 'project':
      return [
        ...projects.map((p) => ({ key: p.id, title: p.title, droppable: true })),
        { key: NONE, title: t.board.noProject, droppable: true },
      ];
    case 'due':
      return [
        { key: 'overdue', title: t.due.overdue, droppable: false },
        { key: 'today', title: t.due.today, droppable: true },
        { key: 'tomorrow', title: t.due.tomorrow, droppable: true },
        { key: 'week', title: t.due.week, droppable: true },
        { key: 'later', title: t.due.later, droppable: true },
        { key: NONE, title: t.due.none, droppable: true },
      ];
  }
}

/**
 * In welche Spalte gehört eine Aufgabe? Bei mehreren Kontexten zählt der, der in den
 * Einstellungen weiter oben steht – nicht der zuerst vergebene.
 */
function columnOf(task: Task, groupBy: GroupBy, contexts: readonly Context[]): string {
  switch (groupBy) {
    case 'status':
      return task.status;
    case 'context':
      return contexts.find((c) => task.contexts.includes(c.id))?.id ?? task.contexts[0] ?? NONE;
    case 'project':
      return task.parentId ?? NONE;
    case 'due':
      return task.dueDate === null ? NONE : dueBucket(task.dueDate);
  }
}

/**
 * Was ein Drop bedeutet. Die Fälligkeitsspalten setzen ein konkretes Datum – "Diese Woche"
 * auf das Wochenende, "Später" auf einen Monat; ein Bereich ohne Datum wäre nicht speicherbar.
 */
async function applyDrop(task: Task, groupBy: GroupBy, column: string): Promise<void> {
  switch (groupBy) {
    case 'status':
      await updateTask(task.id, {
        status: column as TaskStatus,
        completedAt: null,
      });
      return;
    case 'context':
      // Ersetzt die Kontexte: eine Karte liegt in genau einer Spalte, und das Board soll
      // zeigen, was es tut.
      await updateTask(task.id, { contexts: column === NONE ? [] : [column] });
      return;
    case 'project':
      await moveTask(task.id, { parentId: column === NONE ? null : column });
      return;
    case 'due': {
      const ref = today();
      const map: Record<string, string | null> = {
        today: ref,
        tomorrow: addDays(ref, 1),
        week: addDays(ref, 7),
        later: addDays(ref, 30),
        [NONE]: null,
      };
      await updateTask(task.id, { dueDate: map[column] ?? null });
      return;
    }
  }
}

export function BoardView(): React.ReactNode {
  const [groupBy, setGroupBy] = useSetting<GroupBy>('boardGroupBy', 'status');
  const [activeId, setActiveId] = useState<string | null>(null);
  const graph = useGraph();
  const contexts = useContexts();

  const tasks = useMemo(
    () => engageableTasks(graph, { statuses: BOARD_STATUSES, includeDeferred: true }),
    [graph],
  );
  const projects = useMemo(() => [...graph.byId.values()].filter((task) => isProject(graph, task)), [graph]);
  const columns = useMemo(() => buildColumns(groupBy, contexts, projects), [groupBy, contexts, projects]);

  const byColumn = useMemo(() => {
    const sortByOrder = comparator({ key: 'manual', dir: 'asc' });
    const map = new Map<string, Task[]>(columns.map((c) => [c.key, []]));
    for (const task of tasks) {
      const key = columnOf(task, groupBy, contexts);
      // Unbekannte Spalte (z. B. Kontext gelöscht): Karte darf nicht verschwinden.
      const bucket = map.get(key) ?? map.get(NONE);
      bucket?.push(task);
    }
    for (const list of map.values()) list.sort(sortByOrder);
    return map;
  }, [tasks, columns, groupBy, contexts]);

  const boardRef = useRef<HTMLDivElement>(null);
  useHorizontalWheel(boardRef, tasks.length > 0);

  const sensors = useSensors(
    // 8px Toleranz: auf dem Handy soll ein Tap auf die Karte kein Drag auslösen.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setActiveId(null);
    if (over === null) return;
    const task = graph.byId.get(String(active.id));
    if (task === undefined) return;

    const overId = String(over.id);
    const targetKey = overId.startsWith('col:')
      ? overId.slice(4)
      : columnOf(graph.byId.get(overId) ?? task, groupBy, contexts);
    const target = columns.find((c) => c.key === targetKey);
    if (target === undefined || !target.droppable) return;

    void (async () => {
      if (targetKey !== columnOf(task, groupBy, contexts)) await applyDrop(task, groupBy, targetKey);

      // Einsortieren vor der Karte, über der losgelassen wurde; auf der Spalte selbst ans Ende.
      const siblings = (byColumn.get(targetKey) ?? []).filter((s) => s.id !== task.id);
      const index = siblings.findIndex((s) => s.id === overId);
      const afterId = index === -1 ? (siblings.at(-1)?.id ?? null) : (siblings[index - 1]?.id ?? null);
      const beforeId = index === -1 ? null : siblings[index]!.id;
      await moveTask(task.id, { afterId, beforeId });
    })();
  };

  return (
    <>
      <PageHeader
        title={t.board.title}
        subtitle={t.list.count(tasks.length)}
        actions={
          <label className="flex items-center gap-1 text-xs text-muted">
            <span className="sr-only">{t.board.groupBy}</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="h-8 rounded-md border border-line bg-surface px-2 text-xs outline-none hover:border-line-strong focus:border-accent"
            >
              {(['status', 'context', 'project', 'due'] as const).map((g) => (
                <option key={g} value={g}>
                  {t.board.groups[g]}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {tasks.length === 0 ? (
        <EmptyState title={t.empty.board} hint={t.empty.listHint} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={({ active }) => setActiveId(String(active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => t.board.pickedUp(graph.byId.get(String(active.id))?.title ?? ''),
              onDragOver: ({ over }) => (over ? t.board.over(String(over.id)) : ''),
              onDragEnd: ({ over }) => (over ? t.board.moved : t.board.cancelled),
              onDragCancel: () => t.board.cancelled,
            },
          }}
        >
          <div ref={boardRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
            {columns.map((column) => (
              <BoardColumn
                key={column.key}
                column={column}
                tasks={byColumn.get(column.key) ?? []}
                contexts={contexts}
                activeId={activeId}
              />
            ))}
          </div>
        </DndContext>
      )}
    </>
  );
}

/**
 * Mausrad über dem Board scrollt seitwärts – außer über einer Spalte, die selbst
 * vertikal scrollen kann. Sonst wäre die horizontale Bewegung nur über Shift+Rad oder die
 * Scrollleiste erreichbar. Als nativer, nicht-passiver Listener, weil `onWheel` in React
 * passiv ist und `preventDefault` dort nichts bewirkt.
 */
function useHorizontalWheel(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean): void {
  useEffect(() => {
    const board = ref.current;
    if (board === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (board.scrollWidth <= board.clientWidth) return;
      for (let el = event.target as HTMLElement | null; el !== null && el !== board; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight) return;
      }
      event.preventDefault();
      board.scrollLeft += event.deltaY;
    };
    board.addEventListener('wheel', onWheel, { passive: false });
    return () => board.removeEventListener('wheel', onWheel);
  }, [ref, enabled]);
}

function BoardColumn({
  column,
  tasks,
  contexts,
  activeId,
}: {
  column: Column;
  tasks: readonly Task[];
  contexts: readonly Context[];
  activeId: string | null;
}): React.ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}`, disabled: !column.droppable });

  return (
    // Breite: mindestens 16rem, bei freiem Platz bis doppelt so breit. Passen die Spalten
    // in Mindestbreite nicht nebeneinander, wächst keine – dann scrollt das Board seitwärts.
    <section
      ref={setNodeRef}
      aria-label={column.title}
      className={[
        'flex max-h-full min-h-0 max-w-128 shrink-0 grow basis-64 flex-col rounded-card border p-2 transition-colors',
        isOver && column.droppable ? 'border-accent-line bg-accent-soft/40' : 'border-line bg-raised/50',
      ].join(' ')}
    >
      <h2 className="flex items-baseline justify-between px-1 pb-2 text-overline">
        {column.title}
        <span className="tabular-nums">{tasks.length}</span>
      </h2>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        {/* Eigener Scrollbereich je Spalte; -mx-1/px-1 + py-1, damit Fokusring und Schatten nicht abgeschnitten werden. */}
        <ul className="-mx-1 flex min-h-16 flex-col gap-2 overflow-y-auto px-1 py-1">
          {tasks.map((task) => (
            <BoardCard key={task.id} task={task} contexts={contexts} dimmed={activeId === task.id} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

function BoardCard({
  task,
  contexts,
  dimmed,
}: {
  task: Task;
  contexts: readonly Context[];
  dimmed: boolean;
}): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const { toggle } = useTaskActions();

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={dimmed ? 'opacity-40' : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} contexts={contexts} variant="card" onToggle={(x) => void toggle(x)} />
    </li>
  );
}
