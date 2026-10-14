import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTaskActions } from './useTaskActions';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Erfassen muss schneller sein als der Gedanke – ein Feld, kein Formular. Das Overlay
 * schließt sich nicht nach dem Speichern, damit mehrere Gedanken hintereinander in die
 * Inbox können (Capture ist in GTD ein Schwall, kein Einzelvorgang).
 *
 * Wer der eben erfassten Aufgabe doch gleich eine Notiz geben will, kommt über den Link in
 * der Fußzeile oder mit Strg/⌘+Enter direkt ins Detail – Enter bleibt Enter.
 */
export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactNode {
  const [value, setValue] = useState('');
  /** Zuletzt erfasste Aufgabe, bei `+Projekt` der Schritt. */
  const [last, setLast] = useState<Task | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { capture } = useTaskActions();
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setLast(null);
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const save = async (): Promise<Task | null> => {
    const submitted = value;
    const created = await capture(submitted);
    if (created === null) return null;
    // Nur leeren, was gespeichert wurde: wer während des Speicherns schon die nächste
    // Aufgabe tippt, verlöre sie sonst.
    setValue((current) => (current === submitted ? '' : current));
    setLast(created);
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
    const target = value.trim() === '' ? last : await save();
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
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void saveAndOpen();
              }
            }}
            placeholder={t.capture.placeholder}
            aria-label={t.capture.placeholder}
            className="w-full bg-transparent px-1 py-2 text-lg outline-none placeholder:text-subtle"
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <div className="min-w-0 text-xs text-muted" aria-live="polite">
              {last === null ? (
                <span>{t.capture.hint}</span>
              ) : (
                <>
                  <span className="sr-only">{t.capture.saved(last.title)}</span>
                  <Link
                    to={`/task/${last.id}`}
                    onClick={onClose}
                    title={t.capture.editShortcut}
                    aria-label={t.capture.edit(last.title)}
                    className="-my-2 flex min-h-11 items-center gap-1 text-accent hover:underline"
                  >
                    {/* Nur der Titel wird gekürzt – was der Link tut, bleibt immer lesbar. */}
                    <span aria-hidden="true">✓</span>
                    <span className="truncate">„{last.title}“</span>
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
                disabled={value.trim() === ''}
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
