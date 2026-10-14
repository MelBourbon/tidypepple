import { useEffect, useRef } from 'react';
import { DragHandle, SortableItem, SortableList } from './Sortable';
import { TaskCard } from './TaskCard';
import { useTaskActions } from './useTaskActions';
import { isProject, projectProgress, type TaskGraph } from '@/domain/projects';
import type { Context, Task } from '@/domain/types';
import { t } from '@/i18n';

/** Ein Abschnitt der Liste mit eigener Überschrift, z. B. ein Kontext. */
export interface TaskSection {
  key: string;
  title: string;
  tasks: readonly Task[];
  collapsed: boolean;
}

/**
 * Rendert Aufgaben als Liste. Der Projektbezug wird hier aufgelöst, damit jede Ansicht
 * denselben Weg zurück zum Projekt anbietet.
 *
 * Tastaturbedienung setzt auf echten DOM-Fokus statt auf eine zweite, parallel geführte
 * Auswahl: `j`/`k` verschieben den Fokus, `x` erledigt die fokussierte Aufgabe, und Tab
 * sowie Screenreader-Navigation funktionieren unverändert weiter – auch über
 * Abschnittsgrenzen hinweg. Zeilen eingeklappter Abschnitte sind nicht im DOM und werden
 * dabei übersprungen.
 */
export function TaskList({
  tasks,
  contexts,
  graph,
  sections,
  onToggleSection,
  onDelete,
  onReorder,
}: {
  tasks: readonly Task[];
  contexts: readonly Context[];
  graph: TaskGraph;
  /** Ohne Abschnitte eine einzige Liste; mit Abschnitten ersetzen diese `tasks` beim Rendern. */
  sections?: readonly TaskSection[] | undefined;
  onToggleSection?: (key: string) => void;
  onDelete?: (task: Task) => void;
  /** Macht die Liste per Griff umsortierbar (nur ohne Abschnitte), Indizes wie angezeigt. */
  onReorder?: ((from: number, to: number) => void) | undefined;
}): React.ReactNode {
  const { toggle } = useTaskActions();
  const list = useRef<HTMLDivElement>(null);
  const visible = sections === undefined ? tasks : sections.flatMap((s) => (s.collapsed ? [] : s.tasks));
  const focusAfterUpdate = useRef<string | null>(null);

  /**
   * Fokus nach einer Änderung nachziehen. Das passiert in einem Effekt und nicht direkt
   * im Tastendruck: die erledigte Zeile verschwindet erst, wenn die Datenbankabfrage neu
   * geliefert hat – ein sofortiger Zugriff auf das DOM träfe noch die alte Liste.
   */
  useEffect(() => {
    const id = focusAfterUpdate.current;
    if (id === null) return;
    focusAfterUpdate.current = null;
    list.current?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus();
  }, [tasks]);

  const rowLinks = (): HTMLElement[] =>
    [...(list.current?.querySelectorAll<HTMLElement>('[data-task-row]') ?? [])];

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = rowLinks();
    const index = rows.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      const next = index === -1 ? 0 : index + (event.key === 'j' ? 1 : -1);
      rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
      return;
    }

    if (event.key === 'x' && index !== -1) {
      event.preventDefault();
      const id = rows[index]?.dataset['taskId'];
      const task = id === undefined ? undefined : graph.byId.get(id);
      if (task === undefined) return;
      // Nachbarzeile aus den Daten bestimmen, nicht aus dem DOM – sie überlebt das
      // Neurendern, der DOM-Knoten nicht.
      const position = visible.findIndex((v) => v.id === id);
      focusAfterUpdate.current = (visible[position + 1] ?? visible[position - 1])?.id ?? null;
      void toggle(task);
    }
  };

  // `divide-y` sitzt an der Liste, nicht an der Karte: jede Karte ist das einzige Kind
  // ihres `<li>`, ein `last:` an der Karte träfe also jede Zeile.
  const listClass =
    'divide-y divide-line overflow-hidden border-y border-line bg-surface sm:mx-4 sm:rounded-card sm:border-x';

  const sortable = onReorder !== undefined && sections === undefined;

  const rows = (items: readonly Task[]): React.ReactNode =>
    items.map((task) => {
      const parent = task.parentId === null ? undefined : graph.byId.get(task.parentId);
      const card = (
        <TaskCard
          task={task}
          contexts={contexts}
          project={parent !== undefined && isProject(graph, parent) ? parent : undefined}
          progress={isProject(graph, task) ? projectProgress(graph, task) : undefined}
          onToggle={(x) => void toggle(x)}
          onDelete={onDelete}
          handle={sortable ? <DragHandle label={task.title} /> : undefined}
        />
      );
      return sortable ? (
        <SortableItem key={task.id} id={task.id}>
          {card}
        </SortableItem>
      ) : (
        <li key={task.id}>{card}</li>
      );
    });

  return (
    <div ref={list} onKeyDown={onKeyDown} aria-keyshortcuts="j k x">
      {sections === undefined ? (
        sortable ? (
          <SortableList ids={tasks.map((task) => task.id)} onReorder={onReorder}>
            <ul className={listClass}>{rows(tasks)}</ul>
          </SortableList>
        ) : (
          <ul className={listClass}>{rows(tasks)}</ul>
        )
      ) : (
        sections.map((section) => (
          <section key={section.key} aria-label={section.title} className="pb-3">
            <h2>
              <button
                type="button"
                onClick={() => onToggleSection?.(section.key)}
                aria-expanded={!section.collapsed}
                aria-label={t.list.toggleSection(section.title, section.collapsed)}
                className="flex w-full items-center gap-1 px-4 pb-1 text-overline hover:text-accent"
              >
                <span aria-hidden="true" className="inline-block w-3">
                  {section.collapsed ? '▸' : '▾'}
                </span>
                {section.title}
                <span className="ml-auto tabular-nums">{section.tasks.length}</span>
              </button>
            </h2>
            {!section.collapsed && <ul className={listClass}>{rows(section.tasks)}</ul>}
          </section>
        ))
      )}
    </div>
  );
}
