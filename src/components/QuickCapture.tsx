import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTaskActions } from './useTaskActions';
import { dueLabel } from './DueBadge';
import { useContexts, useGraph } from '@/data/hooks';
import { activeToken, applySuggestion, isKnown, isTypeable, searchText, suggest, type SuggestMarker } from '@/domain/captureSuggest';
import { today } from '@/domain/dates';
import { allProjects, findReusableProject } from '@/domain/projects';
import { sortByListOrder } from '@/domain/sort';
import { allTags } from '@/domain/tags';
import { captureDestination, parseQuickAdd, type QuickAddResult } from '@/domain/quickAdd';
import type { IsoDate, Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Erfassen muss schneller sein als der Gedanke – ein Feld, kein Formular. Das Overlay
 * schließt sich nicht nach dem Speichern, damit mehrere Gedanken hintereinander in die
 * Inbox können (Capture ist in GTD ein Schwall, kein Einzelvorgang).
 *
 * Wer der eben erfassten Aufgabe doch gleich eine Notiz geben will, kommt über den Link in
 * der Fußzeile oder mit Strg/⌘+Enter direkt ins Detail – Enter bleibt Enter.
 *
 * Die Syntax ist unsichtbar, solange niemand zeigt, was sie erkannt hat: Die Vorschau unter
 * dem Feld nennt Ziel, Datum und Kürzel, bevor gespeichert wird, und warnt vor Tokens, die
 * wie ein Datum aussehen, aber keins sind. Die Bestätigung sagt, wohin die Aufgabe ging –
 * mit Kontext oder Datum landet sie in Next statt in der Inbox.
 *
 * Nach `@`, `+` und `#` schlägt das Feld vorhandene Namen vor (Tab oder Antippen übernimmt,
 * ↑/↓ wählt, Esc schließt nur die Liste). Enter speichert weiterhin – außer man hat mit den
 * Pfeiltasten bewusst einen Vorschlag gewählt. Was es noch nicht gibt, markiert die
 * Vorschau als „neu“: so fällt `@buero` neben `@büro` auf, bevor ein zweiter Kontext entsteht.
 */
export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactNode {
  const [value, setValue] = useState('');
  /** Zuletzt erfasste Aufgabe (bei `+Projekt` der Schritt) und wohin sie ging. */
  const [last, setLast] = useState<{ task: Task; where: string } | null>(null);
  const parsed = useMemo(() => parseQuickAdd(value), [value]);
  const input = useRef<HTMLInputElement>(null);
  const { capture } = useTaskActions();
  const navigate = useNavigate();

  const contexts = useContexts();
  // Ein Graph (eine Abfrage) für Projekte und Tags – er enthält nur lebende Aufgaben.
  const graph = useGraph();
  const tags = useMemo(() => allTags([...graph.byId.values()]), [graph]);
  /** Was vorgeschlagen wird: nur, was sich als Token getippt wieder genau so liest. */
  const candidates = useMemo<Record<SuggestMarker, readonly string[]>>(
    () => ({
      '@': contexts.map((c) => c.name).filter((name) => isTypeable('@', name)),
      '+': sortByListOrder(allProjects(graph))
        .map((p) => p.title)
        .filter((name) => isTypeable('+', name)),
      '#': tags,
    }),
    [contexts, graph, tags],
  );
  /** Gibt es den Namen schon, oder legt das Speichern ihn an? Dieselben Regeln wie `ensureContexts`/`ensureProject`. */
  const exists = useMemo(
    () => (marker: SuggestMarker, name: string): boolean =>
      marker === '+'
        ? findReusableProject(graph.byId.values(), name) !== undefined
        : isKnown(marker === '@' ? contexts.map((c) => c.name) : tags, name),
    [contexts, graph, tags],
  );

  const [caret, setCaret] = useState(0);
  /** Vorschlagsliste mit Esc geschlossen – gilt für das Token, das an dieser Stelle beginnt. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(-1);
  const pendingCaret = useRef<number | null>(null);
  const token = activeToken(value, caret);
  const options = token === null ? [] : suggest(candidates[token.marker], searchText(token));
  const listOpen = token !== null && options.length > 0 && dismissedAt !== token.start;
  const activeIndex = listOpen && active < options.length ? active : -1;

  // Nach dem Übernehmen eines Vorschlags den Cursor hinter das eingesetzte Token setzen.
  useLayoutEffect(() => {
    if (pendingCaret.current === null || input.current === null) return;
    input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  useEffect(() => {
    if (!open) return;
    setLast(null);
    // Der Text bleibt beim Schließen stehen, der Zustand der Vorschlagsliste nicht.
    setDismissedAt(null);
    setActive(-1);
    const field = input.current;
    if (field === null) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    setCaret(field.value.length);
  }, [open]);

  if (!open) return null;

  const accept = (name: string): void => {
    if (token === null) return;
    const next = applySuggestion(value, token, name);
    pendingCaret.current = next.caret;
    setValue(next.value);
    setActive(-1);
    input.current?.focus();
  };

  /** Tastatur in der Vorschlagsliste; `true`, wenn die Taste dort verbraucht wurde. */
  const handleListKey = (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    // Während einer IME-Komposition gehören Enter und Pfeile der Eingabemethode.
    if (!listOpen || token === null || e.nativeEvent.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const last = options.length - 1;
      if (e.key === 'ArrowDown') setActive(activeIndex >= last ? 0 : activeIndex + 1);
      else setActive(activeIndex <= 0 ? last : activeIndex - 1);
      return true;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      accept(options[Math.max(activeIndex, 0)]!);
      return true;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && activeIndex !== -1) {
      accept(options[activeIndex]!);
      return true;
    }
    if (e.key === 'Escape') {
      setDismissedAt(token.start);
      return true;
    }
    return false;
  };

  const save = async (): Promise<Task | null> => {
    const submitted = value;
    const where = destinationLabel(parsed);
    const created = await capture(submitted);
    if (created === null) return null;
    // Nur leeren, was gespeichert wurde: wer während des Speicherns schon die nächste
    // Aufgabe tippt, verlöre sie sonst.
    setValue((current) => (current === submitted ? '' : current));
    setLast({ task: created, where });
    return created;
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if ((await save()) !== null) input.current?.focus();
  };

  const openTask = (task: Task): void => {
    onClose();
    void navigate(`/task/${task.id}`);
  };

  /** Strg/⌘+Enter: speichern und öffnen; bei leerem Feld die zuletzt erfasste Aufgabe öffnen. */
  const saveAndOpen = async (): Promise<void> => {
    const target = value.trim() === '' ? (last?.task ?? null) : await save();
    if (target !== null) openTask(target);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-overlay p-4 pt-[12vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.capture.open}
        className="w-full max-w-lg rounded-card border border-line bg-surface p-3 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <input
            ref={input}
            value={value}
            onChange={(e) => {
              const nextCaret = e.target.selectionStart ?? e.target.value.length;
              setValue(e.target.value);
              setCaret(nextCaret);
              setActive(-1);
              // Ein geschlossenes Token ist erledigt; das nächste bekommt wieder Vorschläge.
              if (activeToken(e.target.value, nextCaret) === null) setDismissedAt(null);
            }}
            onSelect={(e) => {
              // Bei markiertem Text gibt es keinen Cursor am Tokenende – also auch keine Vorschläge.
              const { selectionStart, selectionEnd } = e.currentTarget;
              setCaret(selectionStart !== null && selectionStart === selectionEnd ? selectionStart : -1);
            }}
            onKeyDown={(e) => {
              if (handleListKey(e)) {
                e.preventDefault();
                return;
              }
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void saveAndOpen();
              }
            }}
            placeholder={t.capture.placeholder}
            aria-label={t.capture.placeholder}
            aria-describedby={value.trim() === '' ? undefined : 'capture-preview'}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listOpen ? 'capture-suggestions' : undefined}
            aria-activedescendant={activeIndex === -1 ? undefined : `capture-suggestion-${activeIndex}`}
            autoComplete="off"
            className="w-full bg-transparent px-1 py-2 text-lg outline-none placeholder:text-subtle"
          />
          {listOpen && token !== null && (
            <ul
              id="capture-suggestions"
              role="listbox"
              aria-label={t.capture.suggestions}
              className="mb-1 flex flex-col border-y border-line py-1"
            >
              {options.map((name, index) => (
                <li
                  key={name}
                  id={`capture-suggestion-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  // Fokus bleibt im Feld: sonst schlösse das Antippen auf dem Handy die Tastatur.
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => accept(name)}
                  className={[
                    'flex min-h-11 cursor-pointer items-center rounded-md px-2 text-sm',
                    index === activeIndex ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-raised',
                  ].join(' ')}
                >
                  <span className="text-muted" aria-hidden="true">{token.marker}</span>
                  <span className="truncate">{name}</span>
                </li>
              ))}
            </ul>
          )}
          {value.trim() !== '' && <CapturePreview id="capture-preview" parsed={parsed} exists={exists} />}
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <div className="min-w-0 text-xs text-muted" aria-live="polite">
              {last === null ? (
                value.trim() === '' && <span>{t.capture.hint}</span>
              ) : (
                <>
                  <span className="sr-only">
                    {t.capture.saved(last.task.title, last.where)}
                  </span>
                  <Link
                    to={`/task/${last.task.id}`}
                    onClick={onClose}
                    title={t.capture.editShortcut}
                    aria-label={t.capture.edit(last.task.title)}
                    className="-my-2 flex min-h-11 min-w-0 items-center gap-1 text-accent hover:underline"
                  >
                    {/* Nur der Titel wird gekürzt – was der Link tut, bleibt immer lesbar. */}
                    <span aria-hidden="true">✓</span>
                    {/* Ziel und Titel teilen sich den Platz – ein langer Projektname darf die Knöpfe nicht überlaufen. */}
                    <span className="min-w-0 truncate text-muted">{t.capture.savedIn(last.where)}</span>
                    <span className="min-w-0 truncate">„{last.task.title}“</span>
                    <span className="shrink-0 whitespace-nowrap">{t.capture.editAction} ›</span>
                  </Link>
                </>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
                {t.capture.cancel}
              </button>
              <button
                type="submit"
                disabled={parsed.title === ''}
                className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.capture.submit}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function destinationLabel(parsed: QuickAddResult): string {
  const destination = captureDestination(parsed);
  if (destination === 'project') return t.capture.toProject(parsed.projectName ?? '');
  return destination === 'inbox' ? t.nav.inbox : t.nav.list;
}

/**
 * Wie im Badge, aber mit Jahr, sobald es nicht das laufende ist: `!1.9` kurz nach dem
 * 1. September ist ein Jahr entfernt, `!2025-10-01` längst vorbei – beides soll man sehen.
 */
function dateLabel(date: IsoDate): string {
  const label = dueLabel(date);
  return date.slice(0, 4) === today().slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`;
}

// Form ohne Farbe – Farben setzt jeder Chip selbst, sonst entschiede die Reihenfolge im
// generierten CSS, welche von zwei widersprüchlichen Klassen gewinnt.
const CHIP = 'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs';
const NEUTRAL = `${CHIP} bg-raised text-muted`;

/** Was beim Speichern entstünde – Ziel zuerst, weil es die häufigste Überraschung ist. */
function CapturePreview({
  id,
  parsed,
  exists,
}: {
  id: string;
  parsed: QuickAddResult;
  exists: (marker: SuggestMarker, name: string) => boolean;
}): React.ReactNode {
  const isNew = (marker: SuggestMarker, name: string): React.ReactNode => (exists(marker, name) ? null : <NewMark />);
  return (
    <div id={id} className="mt-1 flex flex-col gap-1.5 px-1 pb-1">
      {parsed.title === '' ? (
        <p className="text-xs text-danger">{t.capture.noTitle}</p>
      ) : (
        <ul aria-label={t.capture.preview} className="flex flex-wrap items-center gap-1.5">
          <li className={`${CHIP} bg-accent-soft font-medium text-accent`}>
            <span aria-hidden="true" className="mr-1">→</span>
            <span className="truncate">{destinationLabel(parsed)}</span>
            {parsed.projectName !== null && isNew('+', parsed.projectName)}
          </li>
          {parsed.highPriority && <li className={`${CHIP} bg-raised text-danger`}>{t.capture.important}</li>}
          {parsed.dueDate !== null && <li className={`${NEUTRAL} tabular-nums`}>{t.capture.due(dateLabel(parsed.dueDate))}</li>}
          {parsed.deferDate !== null && (
            <li className={`${NEUTRAL} tabular-nums`}>{t.capture.defer(dateLabel(parsed.deferDate))}</li>
          )}
          {parsed.contextNames.map((name) => (
            <li key={`@${name}`} className={NEUTRAL}>
              <span className="truncate">@{name}</span>
              {isNew('@', name)}
            </li>
          ))}
          {parsed.tagNames.map((name) => (
            <li key={`#${name}`} className={NEUTRAL}>
              <span className="truncate">#{name}</span>
              {isNew('#', name)}
            </li>
          ))}
        </ul>
      )}
      {parsed.unrecognized.map((token, index) => (
        <p key={`${index}-${token}`} className="text-xs text-danger">
          {t.capture.notADate(token)}
        </p>
      ))}
    </div>
  );
}

/** Ein Name, den es noch nicht gibt und der beim Speichern angelegt wird. */
function NewMark(): React.ReactNode {
  return <span className="ml-1 shrink-0 font-medium text-ink">· {t.capture.isNew}</span>;
}
