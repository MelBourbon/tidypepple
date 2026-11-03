import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { useDebouncedSave } from '@/components/useDebouncedSave';
import { applyClarify } from '@/data/clarify';
import { useContexts, useGraph } from '@/data/hooks';
import { updateTask } from '@/data/repo';
import { nextToClarify, summarize, type ClarifyDecision, type ClarifyKind } from '@/domain/clarify';
import { addDays, toIsoDate, today } from '@/domain/dates';
import { tasksByStatus } from '@/domain/listQuery';
import type { Context, IsoDate, Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Inbox klären: eine Aufgabe nach der anderen, die älteste zuerst, mit genau einer Frage –
 * was ist das, und was ist der nächste Schritt? Ein eigener Modus statt Knöpfen in jeder
 * Zeile: Klären ist in GTD ein Arbeitsschritt, der zu Ende geführt wird, und die Listen
 * bleiben ruhig.
 *
 * Jede Entscheidung hat eine Taste und führt sofort zur nächsten Aufgabe. Statt eines
 * Bestätigungsdialogs gibt es Undo im Toast – die zurückgenommene Aufgabe ist dann wieder
 * die älteste und kommt als Nächstes dran.
 */

/** Entscheidungen, die vor dem Ausführen noch eine Angabe brauchen. */
type Panel = 'next' | 'waiting' | 'later' | 'project';

/** Reihenfolge des GTD-Flussdiagramms: erst „gleich tun“, zuletzt „weg damit“. */
// Backspace bewusst nicht: wer gerade aus dem Titelfeld kommt und einen Tippfehler
// korrigieren will, soll nicht aus Versehen die ganze Aufgabe löschen.
const DECISIONS: readonly { kind: ClarifyKind; key: string; keyLabel: string; panel?: Panel }[] = [
  { kind: 'done', key: 'x', keyLabel: 'X' },
  { kind: 'next', key: 'n', keyLabel: 'N', panel: 'next' },
  { kind: 'waiting', key: 'w', keyLabel: 'W', panel: 'waiting' },
  { kind: 'later', key: 'l', keyLabel: 'L', panel: 'later' },
  { kind: 'project', key: 'p', keyLabel: 'P', panel: 'project' },
  { kind: 'someday', key: 's', keyLabel: 'S' },
  { kind: 'delete', key: 'delete', keyLabel: t.clarify.deleteKey },
];

function addMonth(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Ende des Folgemonats statt Überlauf: der 31.1. wird zum 28./29.2., nicht zum 3.3.
  const last = new Date(y, m + 1, 0).getDate();
  return toIsoDate(new Date(y, m, Math.min(d, last)));
}

export function ClarifyView(): React.ReactNode {
  const graph = useGraph();
  const contexts = useContexts();
  const toast = useToast();
  const navigate = useNavigate();
  const inbox = useMemo(() => tasksByStatus(graph, ['inbox']), [graph]);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [log, setLog] = useState<readonly ClarifyKind[]>([]);
  // Das Panel gehört zu genau einer Aufgabe: kommt eine andere dran (entschieden, auf einem
  // anderen Gerät erledigt), ist es ohne zusätzlichen Render geschlossen.
  const [openPanel, setOpenPanel] = useState<{ panel: Panel; taskId: string } | null>(null);
  const current = nextToClarify(inbox, skipped);
  const currentId = current?.id ?? null;
  const panel = openPanel !== null && openPanel.taskId === currentId ? openPanel.panel : null;
  const setPanel = (next: Panel | null): void =>
    setOpenPanel(next === null || currentId === null ? null : { panel: next, taskId: currentId });

  /**
   * Die Aufgabe, über die gerade entschieden wurde. Sie bleibt `current`, bis die Live-Abfrage
   * neu gerendert hat – ein schneller zweiter Tastendruck träfe sonst noch einmal sie.
   */
  const decided = useRef<string | null>(null);
  useEffect(() => {
    decided.current = null;
  }, [currentId]);
  /** Der Titel, wie er gerade im Feld steht – noch nicht gespeicherte Anschläge inklusive. */
  const titleDraft = useRef('');
  const rememberTitle = useCallback((draft: string) => {
    titleDraft.current = draft;
  }, []);

  const decide = async (decision: ClarifyDecision): Promise<void> => {
    if (current === null || decided.current === current.id) return;
    decided.current = current.id;
    const title = titleDraft.current.trim() === '' ? current.title : titleDraft.current.trim();
    try {
      const undo = await applyClarify(current, decision);
      if (undo === null) {
        decided.current = null;
        return;
      }
      setOpenPanel(null);
      const { kind } = decision;
      setLog((entries) => [...entries, kind]);
      toast({
        message: `${t.clarify.done[kind]}: ${title}`,
        action: {
          label: t.undo.action,
          onClick: () => {
            void undo();
            setLog((entries) => {
              const index = entries.lastIndexOf(kind);
              return index === -1 ? entries : [...entries.slice(0, index), ...entries.slice(index + 1)];
            });
          },
        },
      });
    } catch (error) {
      decided.current = null;
      throw error;
    }
  };

  const choose = (kind: ClarifyKind): void => {
    const entry = DECISIONS.find((d) => d.kind === kind);
    if (entry?.panel !== undefined) setPanel(entry.panel);
    else if (kind === 'done' || kind === 'someday' || kind === 'delete') void decide({ kind });
  };

  const skip = (): void => {
    if (current !== null) setSkipped((ids) => new Set([...ids, current.id]));
  };

  // Tastatur: die Entscheidungen ohne Panel; in Panels nur Esc (Eingaben regeln Enter selbst).
  const keys = useRef({ choose, skip, panel, current, navigate });
  keys.current = { choose, skip, panel, current, navigate };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // Der Erfassen-Dialog (oder ein anderer) hat seine eigene Tastatur.
      if (event.defaultPrevented || target?.closest('[role="dialog"]') != null) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { choose: pick, skip: pass, panel: open, current: task, navigate: go } = keys.current;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (open !== null) setPanel(null);
        else if (typing) target?.blur();
        else void go('/inbox');
        return;
      }
      if (typing || open !== null || task === null) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        pass();
        return;
      }
      // Kleinbuchstaben: mit Feststelltaste oder Shift kommt `N` statt `n` an.
      const key = event.key.toLowerCase();
      const entry = DECISIONS.find((d) => d.key === key);
      if (entry !== undefined) {
        event.preventDefault();
        pick(entry.kind);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <PageHeader
        title={t.clarify.title}
        subtitle={t.clarify.remaining(inbox.length)}
        showSettings={false}
        actions={
          <Link
            to="/inbox"
            className="flex h-9 items-center rounded-md px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {t.clarify.close}
          </Link>
        }
      />
      <div className="px-4 pt-2">
        {current === null ? (
          <Finished
            log={log}
            skippedLeft={inbox.filter((task) => skipped.has(task.id)).length}
            onRetry={() => setSkipped(new Set())}
          />
        ) : (
          <ClarifyCard
            key={current.id}
            task={current}
            contexts={contexts}
            panel={panel}
            onChoose={choose}
            onSkip={skip}
            onTitleDraft={rememberTitle}
            onClosePanel={() => setPanel(null)}
            onDecide={(decision) => void decide(decision)}
          />
        )}
      </div>
    </>
  );
}

function ClarifyCard({
  task,
  contexts,
  panel,
  onChoose,
  onSkip,
  onTitleDraft,
  onClosePanel,
  onDecide,
}: {
  task: Task;
  contexts: readonly Context[];
  panel: Panel | null;
  onChoose: (kind: ClarifyKind) => void;
  onSkip: () => void;
  onTitleDraft: (draft: string) => void;
  onClosePanel: () => void;
  onDecide: (decision: ClarifyDecision) => void;
}): React.ReactNode {
  const [title, setTitle] = useDebouncedSave(task.title, (next) => {
    if (next.trim() !== '') void updateTask(task.id, { title: next.trim() });
  });
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => onTitleDraft(title), [title, onTitleDraft]);

  // Fokus auf die Karte statt ins Titelfeld: sonst tippte die erste Taste in den Titel.
  useEffect(() => {
    if (panel === null) card.current?.focus({ preventScroll: true });
  }, [panel]);

  return (
    <div ref={card} tabIndex={-1} className="mx-auto max-w-xl outline-none">
      <p className="text-xs text-muted">{t.clarify.question}</p>
      <textarea
        aria-label={t.task.titlePlaceholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        rows={1}
        className="field-sizing-content mt-1 w-full resize-none rounded-md bg-transparent py-1 text-heading-20 leading-7 outline-none focus:bg-raised"
      />
      {task.notes.trim() !== '' && <p className="mt-1 line-clamp-4 text-sm whitespace-pre-line text-muted">{task.notes}</p>}

      <div className="mt-5">
        {panel === null && <DecisionGrid onChoose={onChoose} onSkip={onSkip} />}
        {panel === 'next' && <NextPanel task={task} contexts={contexts} onBack={onClosePanel} onDecide={onDecide} />}
        {panel === 'waiting' && <WaitingPanel onBack={onClosePanel} onDecide={onDecide} />}
        {panel === 'later' && <LaterPanel onBack={onClosePanel} onDecide={onDecide} />}
        {panel === 'project' && <ProjectPanel onBack={onClosePanel} onDecide={onDecide} />}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }): React.ReactNode {
  // Nur mit Tastatur sinnvoll: auf Touch-Geräten (ohne Hover) ausgeblendet.
  return (
    <kbd className="hidden rounded border border-line px-1.5 font-sans text-[11px] leading-5 text-muted [@media(hover:hover)]:inline-block">
      {children}
    </kbd>
  );
}

function DecisionGrid({ onChoose, onSkip }: { onChoose: (kind: ClarifyKind) => void; onSkip: () => void }): React.ReactNode {
  return (
    <ul className="grid grid-cols-2 gap-2">
        {DECISIONS.map(({ kind, keyLabel }) => (
          <li key={kind}>
            <button
              type="button"
              onClick={() => onChoose(kind)}
              aria-keyshortcuts={kind === 'delete' ? 'Delete' : keyLabel.toLowerCase()}
              className={[
                'flex min-h-16 w-full flex-col items-start justify-center gap-0.5 rounded-card border px-3 py-2 text-left transition-colors',
                kind === 'delete'
                  ? 'border-line text-danger hover:bg-danger-soft'
                  : 'border-line bg-surface hover:border-accent hover:bg-accent-soft',
              ].join(' ')}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                {t.clarify.decisions[kind]}
                <Kbd>{keyLabel}</Kbd>
              </span>
              <span className="text-xs text-muted">{t.clarify.hints[kind]}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onSkip}
            aria-keyshortcuts="ArrowRight"
            className="flex min-h-16 w-full items-center justify-between gap-2 rounded-card px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {t.clarify.skip}
            <Kbd>→</Kbd>
          </button>
        </li>
    </ul>
  );
}

/** Gemeinsamer Rahmen der Panels: Inhalt, darunter Zurück und Übernehmen. */
function PanelFrame({
  label,
  onBack,
  onSubmit,
  canSubmit = true,
  focusSubmit = false,
  children,
}: {
  label: string;
  onBack: () => void;
  onSubmit: () => void;
  canSubmit?: boolean;
  /** Fokus auf „Übernehmen“, wenn das Panel kein Eingabefeld hat – Enter übernimmt dann. */
  focusSubmit?: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="rounded-card border border-line bg-surface p-3"
    >
      <p className="mb-2 text-overline">{label}</p>
      {children}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onBack} className="h-9 rounded-md px-3 text-sm text-muted hover:bg-raised hover:text-ink">
          {t.clarify.back}
        </button>
        <button
          type="submit"
          autoFocus={focusSubmit}
          disabled={!canSubmit}
          className="h-9 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t.clarify.confirm}
        </button>
      </div>
    </form>
  );
}

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface px-2 text-sm outline-none hover:border-line-strong focus:border-accent';

function NextPanel({
  task,
  contexts,
  onBack,
  onDecide,
}: {
  task: Task;
  contexts: readonly Context[];
  onBack: () => void;
  onDecide: (decision: ClarifyDecision) => void;
}): React.ReactNode {
  const [selected, setSelected] = useState<readonly string[]>(task.contexts);
  const toggle = (id: string): void =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const submit = (): void => onDecide({ kind: 'next', contexts: selected });

  // Ziffern wählen Kontexte, Enter übernimmt – der Fokus liegt dafür auf „Übernehmen“.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!/^[1-9]$/.test(e.key)) return;
    const context = contexts[Number(e.key) - 1];
    if (context === undefined) return;
    e.preventDefault();
    toggle(context.id);
  };

  return (
    <div onKeyDown={onKeyDown}>
      <PanelFrame label={t.clarify.contextsLabel} onBack={onBack} onSubmit={submit} focusSubmit>
        {contexts.length === 0 ? (
          <p className="text-sm text-muted">{t.clarify.noContexts}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {contexts.map((context, index) => {
              const active = selected.includes(context.id);
              return (
                <button
                  key={context.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(context.id)}
                  className={[
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm',
                    active ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink',
                  ].join(' ')}
                >
                  @{context.name}
                  {index < 9 && <Kbd>{index + 1}</Kbd>}
                </button>
              );
            })}
          </div>
        )}
      </PanelFrame>
    </div>
  );
}

function WaitingPanel({ onBack, onDecide }: { onBack: () => void; onDecide: (decision: ClarifyDecision) => void }): React.ReactNode {
  const [who, setWho] = useState('');
  return (
    <PanelFrame label={t.clarify.waitingFor} onBack={onBack} onSubmit={() => onDecide({ kind: 'waiting', waitingFor: who })}>
      <input
        autoFocus
        value={who}
        onChange={(e) => setWho(e.target.value)}
        placeholder={t.clarify.waitingForPlaceholder}
        aria-label={t.clarify.waitingFor}
        className={FIELD}
      />
    </PanelFrame>
  );
}

function LaterPanel({ onBack, onDecide }: { onBack: () => void; onDecide: (decision: ClarifyDecision) => void }): React.ReactNode {
  const base = today();
  const [date, setDate] = useState<IsoDate>(addDays(base, 7));
  const quick: readonly { label: string; date: IsoDate }[] = [
    { label: t.clarify.tomorrow, date: addDays(base, 1) },
    { label: t.clarify.nextWeek, date: addDays(base, 7) },
    { label: t.clarify.nextMonth, date: addMonth(base) },
  ];
  return (
    <PanelFrame
      label={t.clarify.laterLabel}
      onBack={onBack}
      canSubmit={date > base}
      onSubmit={() => onDecide({ kind: 'later', deferDate: date })}
    >
      <div className="flex flex-wrap gap-2">
        {quick.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onDecide({ kind: 'later', deferDate: option.date })}
            className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-sm text-ink hover:border-accent hover:bg-accent-soft"
          >
            {option.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={date}
        min={addDays(base, 1)}
        onChange={(e) => setDate(e.target.value)}
        aria-label={t.clarify.laterLabel}
        className={`${FIELD} mt-3`}
      />
    </PanelFrame>
  );
}

function ProjectPanel({ onBack, onDecide }: { onBack: () => void; onDecide: (decision: ClarifyDecision) => void }): React.ReactNode {
  const [step, setStep] = useState('');
  return (
    <PanelFrame
      label={t.clarify.firstStep}
      onBack={onBack}
      canSubmit={step.trim() !== ''}
      onSubmit={() => onDecide({ kind: 'project', firstStep: step })}
    >
      <input
        autoFocus
        value={step}
        onChange={(e) => setStep(e.target.value)}
        placeholder={t.clarify.firstStepPlaceholder}
        aria-label={t.clarify.firstStep}
        className={FIELD}
      />
    </PanelFrame>
  );
}

function Finished({
  log,
  skippedLeft,
  onRetry,
}: {
  log: readonly ClarifyKind[];
  skippedLeft: number;
  onRetry: () => void;
}): React.ReactNode {
  const summary = summarize(log);
  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      {skippedLeft === 0 && (
        <>
          <p className="text-heading-20">{t.clarify.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted">{t.clarify.emptyHint}</p>
        </>
      )}
      {summary.length > 0 && (
        <div className="mt-6">
          <p className="text-overline">{t.clarify.summary}</p>
          <ul className="mt-2 flex flex-wrap justify-center gap-2">
            {summary.map(({ kind, count }) => (
              <li key={kind} className="rounded-full bg-raised px-3 py-1 text-sm text-muted tabular-nums">
                {count}× {t.clarify.done[kind]}
              </li>
            ))}
          </ul>
        </div>
      )}
      {skippedLeft > 0 && (
        <div className="mt-6">
          <p className="text-sm text-muted">{t.clarify.skippedLeft(skippedLeft)}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-hover"
          >
            {t.clarify.retrySkipped}
          </button>
        </div>
      )}
      <Link to="/inbox" className="mt-6 inline-flex h-10 items-center text-sm text-accent hover:underline">
        {t.clarify.toInbox}
      </Link>
    </div>
  );
}
