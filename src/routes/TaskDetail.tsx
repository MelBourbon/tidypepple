import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AttachmentSection } from '@/components/AttachmentSection';
import { CompletedStamp } from '@/components/CompletedStamp';
import { CreatedStamp } from '@/components/CreatedStamp';
import { OrderButtons } from '@/components/OrderButtons';
import { PickerChip } from '@/components/PickerChip';
import { PriorityFlag } from '@/components/PriorityFlag';
import { useDebouncedSave } from '@/components/useDebouncedSave';
import { useTaskActions } from '@/components/useTaskActions';
import { useContexts, useGraph, useTags, useTask } from '@/data/hooks';
import { ensureContexts, ensureProject, moveTask, setParent, updateTask } from '@/data/repo';
import { childrenOf, isProject, projectCandidates, type TaskGraph } from '@/domain/projects';
import { tagKey, withoutTag, withTag } from '@/domain/tags';
import { TASK_STATUSES, type Context, type ProjectMode, type Task, type TaskStatus } from '@/domain/types';
import { t } from '@/i18n';
import {
  reminderSupport,
  requestReminderPermission,
  type ReminderPermission,
  type ReminderSupport,
} from '@/platform/notifications';

/**
 * Das Detail ist für Aufgaben und Projekte dasselbe – es *gibt* keinen Unterschied
 * im Modell. Sobald ein Schritt existiert, zeigt die Ansicht zusätzlich die
 * Schrittfolge; das ist die ganze Beförderung zum Projekt aus Sicht des Nutzers.
 */
export function TaskDetail(): React.ReactNode {
  const { id } = useParams<{ id: string }>();
  // `key`: von Aufgabe zu Aufgabe (Schritt, Breadcrumb, Zurück) bleibt die Route dieselbe.
  // Ohne neuen Zustand liefe ein offener Entwurf der vorigen Aufgabe in die neue.
  return <TaskEditor key={id} id={id} />;
}

function TaskEditor({ id }: { id: string | undefined }): React.ReactNode {
  const navigate = useNavigate();
  const task = useTask(id);
  const graph = useGraph();
  const contexts = useContexts();
  const { toggle, remove, addStepTo } = useTaskActions();
  const [newStep, setNewStep] = useState('');

  const [title, setTitle, flushTitle] = useDebouncedSave(task?.title ?? '', (next) => {
    if (id !== undefined && next.trim() !== '') void updateTask(id, { title: next.trim() });
  });
  const [notes, setNotes, flushNotes] = useDebouncedSave(task?.notes ?? '', (next) => {
    if (id !== undefined) void updateTask(id, { notes: next });
  });

  if (id === undefined || task === undefined) {
    return <p className="p-6 text-sm text-muted">{t.task.notFound}</p>;
  }

  const steps = childrenOf(graph, task.id);
  const openSteps = steps.filter((s) => s.status !== 'done');
  const patch = (fields: Partial<Task>): void => void updateTask(task.id, fields);

  return (
    <div className="px-4 pb-10">
      <header className="pt-safe-3 flex items-center justify-between gap-2 pb-3">
        <button type="button" onClick={() => void navigate(-1)} className="-ml-2 flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
          <span aria-hidden="true">←</span> {t.task.close}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={task.highPriority}
            onClick={() => patch({ highPriority: !task.highPriority })}
            className={[
              'flex min-h-11 items-center gap-1 rounded-md px-2 text-sm transition-colors hover:bg-raised',
              task.highPriority ? 'text-danger' : 'text-muted hover:text-ink',
            ].join(' ')}
          >
            <PriorityFlag className="size-4" /> {t.task.highPriority}
          </button>
          <button
            type="button"
            onClick={() => {
              void remove(task);
              void navigate(-1);
            }}
            className="min-h-11 rounded-md px-2 text-sm text-danger transition-colors hover:bg-danger-soft"
          >
            {t.task.delete}
          </button>
        </div>
      </header>

      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={task.status === 'done'}
          aria-label={task.status === 'done' ? t.task.reopen : t.task.complete}
          onClick={() => void toggle(task)}
          className="flex size-11 shrink-0 items-center justify-center"
        >
          <span
            className={[
              'size-5 rounded-full border-2',
              task.status === 'done' ? 'border-accent bg-accent' : 'border-line',
            ].join(' ')}
            aria-hidden="true"
          />
        </button>
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={flushTitle}
          rows={1}
          aria-label={t.task.titlePlaceholder}
          placeholder={t.task.titlePlaceholder}
          // 28px Zeilenhöhe + 8px oben: die erste Zeile steht mittig zum 44px-Knopf daneben.
          className="field-sizing-content w-full resize-none bg-transparent py-2 text-heading-20 leading-7 outline-none"
        />
      </div>

      <div className="-mt-1 mb-1 pl-13">
        <CreatedStamp task={task} className="block" />
        <CompletedStamp task={task} className="block" />
      </div>

      <AssignmentRow task={task} graph={graph} contexts={contexts} patch={patch} />

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={t.task.status}>
          <select
            value={task.status}
            onChange={(e) => patch({ status: e.target.value as TaskStatus })}
            className="w-full h-10 rounded-md border border-line bg-surface px-2 text-sm outline-none hover:border-line-strong focus:border-accent"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.status[s]}
              </option>
            ))}
          </select>
        </Field>

        {task.status === 'waiting' && (
          <Field label={t.task.waitingFor}>
            <input
              value={task.waitingFor ?? ''}
              onChange={(e) => patch({ waitingFor: e.target.value === '' ? null : e.target.value })}
              placeholder={t.task.waitingForPlaceholder}
              className="w-full h-10 rounded-md border border-line bg-surface px-2 text-sm outline-none hover:border-line-strong focus:border-accent"
            />
          </Field>
        )}
      </section>

      {/* Auch auf dem Handy nebeneinander: zwei Datumsfelder passen ab 320 px in eine Zeile. */}
      <section className="mt-4 grid grid-cols-2 gap-2">
        <DateField
          label={t.task.dueDate}
          value={task.dueDate}
          // Eine Uhrzeit ohne Datum ergibt keinen Sinn – sie geht mit.
          onChange={(dueDate) => patch(dueDate === null ? { dueDate, dueTime: null } : { dueDate })}
        />
        <DateField label={t.task.deferDate} value={task.deferDate} onChange={(deferDate) => patch({ deferDate })} />
      </section>

      <ReminderField value={task.reminderAt} onChange={(reminderAt) => patch({ reminderAt })} />

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-overline">{t.task.steps}</h2>
          {isProject(graph, task) && (
            <ModeToggle mode={task.projectMode} onChange={(mode) => patch({ projectMode: mode })} />
          )}
        </div>

        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-1 border-b border-line last:border-b-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={step.status === 'done'}
                aria-label={step.status === 'done' ? t.task.reopen : t.task.complete}
                onClick={() => void toggle(step)}
                className="flex size-11 shrink-0 items-center justify-center"
              >
                <span
                  className={[
                    'size-4 rounded-full border-2',
                    step.status === 'done' ? 'border-accent bg-accent' : 'border-line',
                  ].join(' ')}
                  aria-hidden="true"
                />
              </button>
              <Link
                to={`/task/${step.id}`}
                className={['flex-1 py-2.5 text-sm', step.status === 'done' ? 'text-muted line-through' : ''].join(' ')}
              >
                {step.title}
              </Link>
              <OrderButtons
                items={steps}
                index={index}
                label={`„${step.title}"`}
                onMove={(id, target) => void moveTask(id, target)}
              />
            </li>
          ))}
          <li className="flex items-center gap-1 px-2">
            <form
              className="flex flex-1 items-center"
              onSubmit={(e) => {
                e.preventDefault();
                void addStepTo(task, newStep);
                setNewStep('');
              }}
            >
              <input
                value={newStep}
                onChange={(e) => setNewStep(e.target.value)}
                placeholder={t.task.addStep}
                aria-label={t.task.addStep}
                className="min-h-11 w-full bg-transparent px-1 text-sm outline-none placeholder:text-subtle"
              />
            </form>
          </li>
        </ul>

        {openSteps.length >= 2 && (
          <p className="mt-1.5 text-xs text-muted">{t.task.modeHint[task.projectMode]}</p>
        )}
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-overline">{t.task.notes}</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={flushNotes}
          rows={4}
          placeholder={t.task.notesPlaceholder}
          className="w-full rounded-md border border-line bg-surface p-3 text-sm outline-none hover:border-line-strong focus:border-accent"
        />
      </section>

      <AttachmentSection task={task} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-overline">{label}</span>
      {children}
    </label>
  );
}

/**
 * Eigener Knopf zum Entfernen, weil sich der native Datumswähler nicht überall leeren
 * lässt – iOS Safari etwa bietet gar keinen Weg dafür. Der Knopf steht
 * außerhalb des <label>, sonst wird sein Name Teil des Feldnamens.
 */
function DateField({
  label,
  value,
  onChange,
  type = 'date',
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  type?: 'date' | 'datetime-local';
}): React.ReactNode {
  return (
    // min-w-0: in der zweispaltigen Zeile darf das Feld schmaler werden als sein Inhalt will.
    <div className="flex min-w-0 items-end gap-0.5">
      <div className="min-w-0 flex-1">
        <Field label={label}>
          <input
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            className="w-full min-w-0 h-10 rounded-md border border-line bg-surface px-2 text-sm outline-none hover:border-line-strong focus:border-accent"
          />
        </Field>
      </div>
      {value !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t.task.clearDate(label)}
          className="flex size-8 shrink-0 items-center justify-center text-muted hover:text-danger"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

const reminderNotice = (kind: ReminderSupport, permission: ReminderPermission): string | null => {
  if (kind === 'outdated-app') return t.task.reminderAppOutdated;
  if (kind === 'unsupported') return t.task.reminderUnsupported;
  if (permission === 'denied') return t.task.reminderBlocked;
  return kind === 'browser' ? t.task.reminderBrowserHint : null;
};

/**
 * Erinnerung mit Datum und Uhrzeit, eine ganze Zeile. Nach der Erlaubnis für
 * Benachrichtigungen fragt erst das Setzen – vorher gäbe es keinen Grund dafür.
 */
function ReminderField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}): React.ReactNode {
  const [notice, setNotice] = useState<string | null>(null);

  // Beim Öffnen nur nachsehen, nicht fragen: In der Hülle würde die Abfrage gleich den
  // System-Dialog zeigen, deshalb gilt dort „erlaubt“, bis das Setzen etwas anderes ergibt.
  const hasValue = value !== null;
  useEffect(() => {
    if (!hasValue) return;
    let active = true;
    void reminderSupport().then(({ kind }) => {
      if (active) setNotice(reminderNotice(kind, kind === 'browser' ? Notification.permission : 'granted'));
    });
    return () => {
      active = false;
    };
  }, [hasValue]);

  const change = (next: string | null): void => {
    onChange(next);
    if (next === null) {
      setNotice(null);
      return;
    }
    void Promise.all([reminderSupport(), requestReminderPermission()]).then(([{ kind }, permission]) =>
      setNotice(reminderNotice(kind, permission)),
    );
  };

  return (
    <section className="mt-4">
      <DateField type="datetime-local" label={t.task.reminder} value={value} onChange={change} />
      {hasValue && notice !== null && <p className="mt-1.5 text-xs text-muted">{notice}</p>}
    </section>
  );
}

/**
 * Kontext, Tags und Projekt als je ein Chip in einer Zeile: er nennt nur die Zuordnung, die
 * Auswahl klappt erst auf Klick auf. Neues entsteht direkt im Textfeld der Auswahl – Tags
 * wie beim Erfassen ohne Verwaltung, Kontexte und Projekte als eigene Records.
 * Der Projekt-Chip ersetzt den früheren Link „Teil von …“.
 */
function AssignmentRow({
  task,
  graph,
  contexts,
  patch,
}: {
  task: Task;
  graph: TaskGraph;
  contexts: readonly Context[];
  patch: (fields: Partial<Task>) => void;
}): React.ReactNode {
  const knownTags = useTags();
  // Die eigenen Tags in eigener Schreibweise, dazu alle übrigen als Vorschlag.
  const tags = [...knownTags.filter((tag) => !task.tags.some((own) => tagKey(own) === tagKey(tag))), ...task.tags].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  const projects = projectCandidates(graph, task);
  const parent = task.parentId === null ? undefined : graph.byId.get(task.parentId);

  const toggleContext = (id: string): void =>
    patch({ contexts: task.contexts.includes(id) ? task.contexts.filter((x) => x !== id) : [...task.contexts, id] });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
      <PickerChip
        name={t.task.context}
        prefix="@"
        multiple
        options={contexts.map((c) => ({ value: c.id, label: c.name }))}
        selected={task.contexts}
        onToggle={toggleContext}
        onCreate={(name) =>
          void ensureContexts([name]).then(([id]) => {
            if (id !== undefined && !task.contexts.includes(id)) patch({ contexts: [...task.contexts, id] });
          })
        }
      />
      <PickerChip
        name={t.task.tag}
        prefix="#"
        multiple
        options={tags.map((tag) => ({ value: tag, label: tag }))}
        selected={task.tags}
        onToggle={(tag) =>
          patch({ tags: task.tags.some((own) => tagKey(own) === tagKey(tag)) ? withoutTag(task.tags, tag) : withTag(task.tags, tag) })
        }
        // Mehrere auf einmal: "steuer belege" oder "steuer, belege".
        onCreate={(text) => {
          const next = text.split(/[\s,]+/).reduce<string[]>((list, name) => withTag(list, name), [...task.tags]);
          if (next.length !== task.tags.length) patch({ tags: next });
        }}
      />
      <PickerChip
        name={t.task.project}
        prefix="+"
        multiple={false}
        align="end"
        options={projects.map((p) => ({ value: p.id, label: p.title }))}
        selected={task.parentId === null ? [] : [task.parentId]}
        onToggle={(id) => void setParent(task.id, id)}
        onCreate={(name) => void ensureProject(name).then((project) => setParent(task.id, project.id))}
        clearLabel={t.task.noProject}
        onClear={() => void setParent(task.id, null)}
        header={
          parent !== undefined && (
            <Link
              to={`/task/${parent.id}`}
              className="mb-1 flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-accent hover:bg-raised"
            >
              <span aria-hidden="true">↑</span> {t.task.openProject}
            </Link>
          )
        }
      />
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: ProjectMode; onChange: (mode: ProjectMode) => void }): React.ReactNode {
  return (
    <div className="flex gap-0.5 rounded-md border border-line bg-surface p-0.5 text-xs">
      {(['sequential', 'parallel'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          className={['rounded-sm px-2 py-1 transition-colors', mode === value ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink'].join(' ')}
        >
          {value === 'sequential' ? t.task.modeSequential : t.task.modeParallel}
        </button>
      ))}
    </div>
  );
}
