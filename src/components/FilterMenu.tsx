import { useEffect, useId, useRef, useState } from 'react';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Ein Filter-Chip mit aufklappbarer Mehrfachauswahl: eine Chipzeile bleibt
 * kurz, egal wie viele Kontexte oder Status es gibt. Der Chip nennt die Auswahl, damit man
 * weiterhin sieht, warum die Liste kurz ist. Leere Auswahl heißt: kein Filter.
 */
export function FilterMenu<T extends string>({
  name,
  options,
  selected,
  onChange,
  countLabel,
  resetLabel,
  align = 'start',
}: {
  /** Beschriftung ohne Auswahl, zugleich Name der Gruppe für Screenreader. */
  name: string;
  options: readonly FilterOption<T>[];
  selected: readonly T[];
  onChange: (values: T[]) => void;
  countLabel: (n: number) => string;
  resetLabel: string;
  /** Rechtsbündig aufklappen, wenn der Chip weit rechts steht und das Feld sonst überstünde. */
  align?: 'start' | 'end';
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auswahl, deren Option es nicht mehr gibt (z. B. ein gelöschter Kontext), zählt nicht mit.
  const chosen = options.filter((o) => selected.includes(o.value));
  const active = chosen.length > 0;
  const label = chosen.length === 1 ? chosen[0]!.label : active ? countLabel(chosen.length) : name;

  const toggle = (value: T): void =>
    onChange(
      // In der Reihenfolge der Optionen speichern, egal in welcher Reihenfolge angeklickt wurde.
      options
        .filter((o) => (o.value === value ? !selected.includes(o.value) : selected.includes(o.value)))
        .map((o) => o.value),
    );

  return (
    <div ref={rootRef} className="relative min-w-0 shrink">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active ? `${name}: ${chosen.map((o) => o.label).join(', ')}` : undefined}
        className={[
          'inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
          active ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
        ].join(' ')}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <fieldset
          id={panelId}
          className={[
            'absolute top-full z-20 mt-1 max-h-80 w-max max-w-[calc(100vw-2rem)] min-w-44 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-menu',
            align === 'end' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          <legend className="sr-only">{name}</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-raised"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="size-4 shrink-0 accent-accent"
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md border-t border-line px-2 py-2 text-left text-sm text-muted hover:bg-raised hover:text-ink"
            >
              {resetLabel}
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}
