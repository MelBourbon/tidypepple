import { Link } from 'react-router-dom';
import { ContextChip } from './ContextChip';
import { CompletedStamp } from './CompletedStamp';
import { DueBadge } from './DueBadge';
import { PriorityFlag } from './PriorityFlag';
import { ReminderBadge } from './ReminderBadge';
import { WaitingBadge } from './WaitingBadge';
import type { ProjectProgress } from '@/domain/projects';
import { hasPendingReminder } from '@/domain/reminders';
import type { Context, Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Eine Karte für Liste *und* Board. Dieselbe Komponente in beiden Ansichten ist der
 * Grund, warum Fälligkeit und Kontexte überall gleich aussehen und nirgends fehlen können.
 *
 * Progressive Disclosure: die Karte zeigt Titel, Priorität, Wartestand, Kontexte, Tags, Datum und Projektbezug –
 * alles Weitere erst im Detail.
 */

export interface TaskCardProps {
  task: Task;
  contexts: readonly Context[];
  /** Das Projekt, zu dem diese Aufgabe als nächster Schritt gehört. */
  project?: Task | undefined;
  /** Gesetzt, wenn die Aufgabe selbst ein Projekt ist – in "All" stehen ruhende Projekte als Zeile. */
  progress?: ProjectProgress | undefined;
  variant?: 'row' | 'card';
  onToggle: (task: Task) => void;
  /** Blendet einen Löschknopf ein – nur in der Ansicht "Erledigt". */
  onDelete?: ((task: Task) => void) | undefined;
  /** Griff zum Umsortieren am Ende der Zeile – nur bei manueller Sortierung. */
  handle?: React.ReactNode;
}

export function TaskCard({
  task,
  contexts,
  project,
  progress,
  variant = 'row',
  onToggle,
  onDelete,
  handle,
}: TaskCardProps): React.ReactNode {
  const done = task.status === 'done';
  const taskContexts = contexts.filter((c) => task.contexts.includes(c.id));
  const hasMeta =
    taskContexts.length > 0 ||
    task.tags.length > 0 ||
    (!done && task.dueDate !== null) ||
    (!done && hasPendingReminder(task, Date.now())) ||
    task.status === 'waiting' ||
    project !== undefined ||
    progress !== undefined ||
    task.attachments.length > 0 ||
    (done && task.completedAt !== null);

  return (
    <div
      className={[
        // `isolate`: die `z-10` der Bedienelemente gelten nur innerhalb der Karte. Sonst liegen
        // sie beim Scrollen über dem sticky Header, der ebenfalls `z-10` hat.
        'group relative isolate flex items-start gap-1',
        variant === 'row'
          ? 'bg-surface px-2'
          : 'rounded-card border border-line bg-surface px-1 py-0.5 shadow-small',
      ].join(' ')}
    >
      {/* 44px Touch-Target nach den Mobile-Richtlinien, auch wenn das Kästchen kleiner aussieht. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? t.task.reopen : t.task.complete}
        onClick={() => onToggle(task)}
        className="relative z-10 flex size-11 shrink-0 items-center justify-center"
      >
        <span
          className={[
            'flex size-5 items-center justify-center rounded-full border-2 transition-colors',
            done ? 'border-accent bg-accent text-accent-ink' : 'border-line group-hover:border-accent',
          ].join(' ')}
          aria-hidden="true"
        >
          {done && (
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1 py-2.5 pr-2">
        {/*
          Stretched Link: der Titel ist das Linkziel, sein Pseudo-Element deckt die ganze
          Karte ab. Das gibt eine große Trefferfläche, ohne Links ineinander zu verschachteln
          (was ungültiges HTML wäre und Screenreader verwirrt).
        */}
        <Link
          to={`/task/${task.id}`}
          data-task-row=""
          data-task-id={task.id}
          className={[
            // 24px Zeilenhöhe + 10px Innenabstand oben: die erste Zeile steht mittig zum 44px-Knopf.
            'block text-base leading-6 after:absolute after:inset-0 after:content-[""]',
            done ? 'text-muted line-through' : '',
          ].join(' ')}
        >
          {task.highPriority && (
            <span className="mr-1 inline-flex align-[-2px] text-danger" title={t.task.highPriority}>
              <PriorityFlag />
              <span className="sr-only">{t.task.highPriority}: </span>
            </span>
          )}
          {task.title}
        </Link>

        {hasMeta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {progress !== undefined && <ProjectBadge progress={progress} />}
            <WaitingBadge task={task} />
            {/* Erledigtes ist nicht mehr fällig – auch ältere Aufgaben, die ihr Datum noch tragen. */}
            {!done && <DueBadge due={task.dueDate} time={task.dueTime} />}
            {!done && <ReminderBadge task={task} />}
            {taskContexts.map((c) => (
              <ContextChip key={c.id} context={c} />
            ))}
            {task.tags.map((tag) => (
              <span key={tag} className="max-w-full truncate text-xs text-muted">
                #{tag}
              </span>
            ))}
            {project !== undefined && <ProjectChip project={project} />}
            <CompletedStamp task={task} />
            {task.attachments.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted" title={t.attachments.count(task.attachments.length)}>
                {/* Büroklammer (Lucide „paperclip", ISC-Lizenz) */}
                <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span aria-hidden="true">{task.attachments.length}</span>
                <span className="sr-only">{t.attachments.count(task.attachments.length)}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {onDelete !== undefined && (
        <button
          type="button"
          onClick={() => onDelete(task)}
          aria-label={`${t.task.delete}: ${task.title}`}
          title={t.task.delete}
          className="relative z-10 flex size-11 shrink-0 items-center justify-center text-muted hover:text-danger"
        >
          {/* Mülleimer (Lucide „trash-2", ISC-Lizenz) */}
          <svg
            viewBox="0 0 24 24"
            className="size-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
          </svg>
        </button>
      )}
      {handle}
    </div>
  );
}

/** Der Weg vom nächsten Schritt zurück zum Projekt (liegt über dem Stretched Link). */
function ProjectChip({ project }: { project: Task }): React.ReactNode {
  return (
    <Link
      to={`/projects/${project.id}`}
      title={`${t.task.partOf} ${project.title}`}
      className="relative z-10 inline-flex max-w-[min(12rem,100%)] min-w-0 items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-xs text-muted hover:text-accent"
    >
      <FolderIcon />
      <span className="truncate">{project.title}</span>
    </Link>
  );
}

/** Macht ein Projekt als Zeile von einem gewöhnlichen Schritt unterscheidbar. */
function ProjectBadge({ progress }: { progress: ProjectProgress }): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
      <FolderIcon />
      {t.projects.badge} · {t.projects.progress(progress.done, progress.total)}
    </span>
  );
}

function FolderIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4l1.2 1.5h5.4A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    </svg>
  );
}
