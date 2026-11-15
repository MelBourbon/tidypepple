import { useState } from 'react';
import { appendItem, hasChecklist, parseNotes, toggleItem } from '@/domain/checklist';
import { MAX_NOTES_LENGTH } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Notizen mit optionaler Checkliste. Ohne Punkte bleibt es das schlichte Textfeld – die
 * Checkliste erscheint erst, wenn man sie will. Mit Punkten zeigt das Feld sie zum Abhaken;
 * „Bearbeiten“ öffnet den Text samt `- [ ]`-Zeilen. Gespeichert wird über `setNotes`, also
 * mit demselben Debounce wie beim Tippen.
 */
export function NotesField({
  notes,
  setNotes,
  flushNotes,
}: {
  notes: string;
  setNotes: (next: string) => void;
  flushNotes: () => void;
}): React.ReactNode {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [item, setItem] = useState('');

  const checklist = hasChecklist(notes);
  const showList = (checklist || adding) && !editing;

  const startEditing = (): void => {
    setAdding(false);
    setEditing(true);
  };

  return (
    <section className="mt-5">
      <div className="mb-2 flex min-h-7 items-center justify-between">
        <h2 className="text-overline">{t.task.notes}</h2>
        {showList ? (
          <button type="button" onClick={startEditing} className="rounded-sm px-2 py-1 text-xs text-muted transition-colors hover:text-ink">
            {t.task.editNotes}
          </button>
        ) : (
          !checklist && (
            <button
              type="button"
              onClick={() => {
                flushNotes();
                setEditing(false);
                setAdding(true);
              }}
              className="rounded-sm px-2 py-1 text-xs text-muted transition-colors hover:text-ink"
            >
              {t.task.addChecklist}
            </button>
          )
        )}
      </div>

      {showList ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {parseNotes(notes).map((segment, index) =>
            segment.kind === 'text' ? (
              <button
                key={`text-${index}`}
                type="button"
                onClick={startEditing}
                title={t.task.editNotes}
                className="block w-full border-b border-line px-3 py-2.5 text-left text-sm whitespace-pre-line"
              >
                {segment.text.trim()}
              </button>
            ) : (
              <button
                key={`item-${segment.line}`}
                type="button"
                role="checkbox"
                aria-checked={segment.done}
                onClick={() => setNotes(toggleItem(notes, segment.line))}
                className="flex w-full items-center gap-1 border-b border-line pr-3 text-left"
              >
                <span className="flex size-11 shrink-0 items-center justify-center" aria-hidden="true">
                  <span
                    className={[
                      'flex size-4 items-center justify-center rounded-sm border-2',
                      segment.done ? 'border-accent bg-accent text-accent-ink' : 'border-line',
                    ].join(' ')}
                  >
                    {segment.done && (
                      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                </span>
                <span className={['flex-1 py-2.5 text-sm', segment.done ? 'text-muted line-through' : ''].join(' ')}>
                  {segment.text}
                </span>
              </button>
            ),
          )}
          <form
            className="flex items-center px-3"
            onSubmit={(e) => {
              e.preventDefault();
              setNotes(appendItem(notes, item));
              setItem('');
            }}
          >
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              onBlur={() => {
                if (!checklist && item.trim() === '') setAdding(false);
              }}
              // Nur nach „+ Checkliste“: dann will man sofort den ersten Punkt tippen.
              autoFocus={adding && !checklist}
              placeholder={t.task.addItem}
              aria-label={t.task.addItem}
              className="min-h-11 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </form>
        </div>
      ) : (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            flushNotes();
            setEditing(false);
          }}
          autoFocus={editing}
          rows={4}
          maxLength={MAX_NOTES_LENGTH}
          aria-label={t.task.notes}
          placeholder={t.task.notesPlaceholder}
          className="w-full rounded-md border border-line bg-surface p-3 text-sm outline-none hover:border-line-strong focus:border-accent"
        />
      )}
    </section>
  );
}
