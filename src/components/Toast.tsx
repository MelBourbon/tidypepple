import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@/i18n';

/**
 * Undo statt Rückfrage: destruktive Aktionen laufen sofort durch und sind für einige
 * Sekunden zurücknehmbar (Nielsen – "user control and freedom"). Das erspart jeden
 * Bestätigungsdialog und ist auf dem Handy deutlich schneller.
 */

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastSpec {
  message: string;
  action?: ToastAction;
  /** Anzeigedauer in ms. */
  duration?: number;
}

interface ToastEntry extends ToastSpec {
  id: number;
}

const ToastContext = createContext<((spec: ToastSpec) => void) | null>(null);

export function useToast(): (spec: ToastSpec) => void {
  const show = useContext(ToastContext);
  if (show === null) throw new Error('useToast() braucht einen <ToastProvider>.');
  return show;
}

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toast, setToast] = useState<ToastEntry | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const show = useCallback((spec: ToastSpec) => {
    if (timer.current !== null) clearTimeout(timer.current);
    nextId.current += 1;
    const entry: ToastEntry = { ...spec, id: nextId.current };
    setToast(entry);
    timer.current = setTimeout(() => {
      setToast((current) => (current?.id === entry.id ? null : current));
    }, spec.duration ?? 6000);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext value={value}>
      {children}
      {/* aria-live, damit Screenreader die Rücknahme-Möglichkeit mitbekommen. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6"
      >
        {toast !== null && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-sm shadow-menu">
            <span>{toast.message}</span>
            {toast.action !== undefined && (
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label={t.task.close}
              className="text-muted hover:text-ink"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </ToastContext>
  );
}
