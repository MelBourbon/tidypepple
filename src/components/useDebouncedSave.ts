import { useEffect, useRef, useState } from 'react';

/**
 * Tippen soll nicht bei jedem Anschlag in IndexedDB schreiben (und später einen
 * Sync-Push auslösen). Der Entwurf lebt lokal, gespeichert wird nach kurzer Ruhe.
 */
export function useDebouncedSave<T>(
  value: T,
  save: (next: T) => void,
  delay = 400,
): [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Änderungen von außen (Sync, anderes Gerät) übernehmen – aber nie einen
  // ungespeicherten Entwurf überschreiben, an dem gerade getippt wird.
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!dirty.current) return;
    const id = setTimeout(() => {
      dirty.current = false;
      saveRef.current(draft);
    }, delay);
    return () => clearTimeout(id);
  }, [draft, delay]);

  // Wer die Ansicht verlässt, ohne dass das Feld den Fokus verliert (Zurück-Geste), darf
  // die letzten Anschläge nicht verlieren: beim Abbau wird gespeichert statt verworfen.
  useEffect(
    () => () => {
      if (!dirty.current) return;
      dirty.current = false;
      saveRef.current(draftRef.current);
    },
    [],
  );

  const update = (next: T): void => {
    dirty.current = true;
    setDraft(next);
  };

  const flush = (): void => {
    if (!dirty.current) return;
    dirty.current = false;
    saveRef.current(draftRef.current);
  };

  return [draft, update, flush];
}
