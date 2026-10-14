import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/i18n';

export interface PickerOption {
  value: string;
  label: string;
}

/**
 * Ein Chip im Aufgaben-Detail, der nur die Zuordnung nennt – `@online`, bei mehreren
 * `@online +1`, ohne Zuordnung den Namen des Felds. Ein Klick klappt die Auswahl auf: alle
 * Einträge zum An- und Abwählen und ein Textfeld, das filtert oder einen neuen anlegt. So
 * kostet ein Feld eine Chipbreite statt einer Zeile voller Chips.
 *
 * Aufklappen und Schließen wie bei `FilterMenu`.
 */
export function PickerChip({
  name,
  prefix,
  options,
  selected,
  multiple,
  onToggle,
  onCreate,
  clearLabel,
  onClear,
  header,
  align = 'start',
}: {
  /** Beschriftung ohne Auswahl, zugleich Name der Gruppe für Screenreader. */
  name: string;
  prefix: string;
  options: readonly PickerOption[];
  selected: readonly string[];
  /** Mehrfachauswahl bleibt offen; Einfachauswahl schließt nach dem Wählen. */
  multiple: boolean;
  onToggle: (value: string) => void;
  /** Legt aus dem Text einen neuen Eintrag an und wählt ihn. */
  onCreate: (text: string) => void;
  /** Eintrag „keine Zuordnung“ – nur bei Einfachauswahl sinnvoll. */
  clearLabel?: string;
  onClear?: () => void;
  header?: React.ReactNode;
  align?: 'start' | 'end';
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const close = (): void => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    // Mit Maus gleich lostippen können. Auf dem Handy nicht: die Tastatur verdeckte die Liste,
    // aus der man meist nur wählen will.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // In der Reihenfolge der Auswahl: der Chip nennt den zuerst vergebenen Eintrag. Auswahl, deren
  // Option es nicht mehr gibt (z. B. ein gelöschter Kontext), zählt nicht mit.
  const chosen = selected
    .map((value) => options.find((o) => o.value === value))
    .filter((o): o is PickerOption => o !== undefined);
  const active = chosen.length > 0;
  const label = active
    ? `${prefix}${chosen[0]!.label}${chosen.length > 1 ? ` +${chosen.length - 1}` : ''}`
    : name;

  // Das Präfix darf mitgetippt werden: "@büro" findet und legt "büro" an.
  const text = query.trim().replace(new RegExp(`^\\${prefix}+`), '').trim();
  const key = text.toLowerCase();
  const visible = key === '' ? options : options.filter((o) => o.label.toLowerCase().includes(key));
  const exact = options.find((o) => o.label.toLowerCase() === key);

  const pick = (value: string): void => {
    onToggle(value);
    setQuery('');
    if (!multiple) close();
  };
  const submit = (): void => {
    if (text === '') return;
    if (exact !== undefined) {
      // Bei Mehrfachauswahl wählt Enter einen vorhandenen Eintrag nur an, nie ab.
      if (!multiple || !selected.includes(exact.value)) pick(exact.value);
      else setQuery('');
      return;
    }
    onCreate(text);
    setQuery('');
    if (!multiple) close();
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active ? `${name}: ${chosen.map((o) => o.label).join(', ')}` : name}
        className={[
          'inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap',
          active ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
        ].join(' ')}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={name}
          className={[
            'absolute top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-1 shadow-menu',
            align === 'end' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {header}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              ref={inputRef}
              placeholder={t.task.pickerSearch}
              aria-label={t.task.pickerSearchLabel(name)}
              enterKeyHint="done"
              className="mb-1 min-h-10 w-full rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-accent"
            />
          </form>
          <div className="max-h-64 overflow-y-auto">
            {onClear !== undefined && clearLabel !== undefined && key === '' && (
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-muted hover:bg-raised">
                <input
                  type="radio"
                  name={panelId}
                  checked={!active}
                  onChange={() => {
                    onClear();
                    close();
                  }}
                  className="size-4 shrink-0 accent-accent"
                />
                <span className="truncate">{clearLabel}</span>
              </label>
            )}
            {visible.map((option) => (
              <label
                key={option.value}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-raised"
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={multiple ? undefined : panelId}
                  checked={selected.includes(option.value)}
                  onChange={() => pick(option.value)}
                  className="size-4 shrink-0 accent-accent"
                />
                <span className="truncate">
                  {prefix}
                  {option.label}
                </span>
              </label>
            ))}
            {text !== '' && exact === undefined && (
              <button
                type="button"
                onClick={submit}
                className="flex min-h-10 w-full items-center rounded-md px-2 text-left text-sm text-accent hover:bg-raised"
              >
                <span className="truncate">{t.task.pickerCreate(`${prefix}${text}`)}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
