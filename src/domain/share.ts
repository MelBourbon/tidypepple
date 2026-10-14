/**
 * Geteilte Inhalte (Android-Teilen-Menü) in eine Inbox-Aufgabe übersetzen.
 *
 * Apps füllen `title`, `text` und `url` sehr uneinheitlich: Chrome schickt den Seitentitel
 * als `title` und die Adresse in `text`, Messenger nur `text`, manche Apps die URL doppelt.
 * Deshalb landet in der Notiz alles, was da ist – ohne Wiederholungen.
 *
 * Geteilte Fotos und PDFs (nur in der Android-App) werden Anhänge. Kommt dazu kein Text,
 * gibt der erste Dateiname den Titel.
 */

export interface SharedData {
  title?: string | null | undefined;
  text?: string | null | undefined;
  url?: string | null | undefined;
  /** Namen geteilter Dateien. */
  files?: readonly string[] | undefined;
}

/** Länger wird ein Titel aus dem Text nicht – der Rest steht ja in der Notiz. */
export const SHARE_TITLE_MAX = 60;

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/** Erste nichtleere Zeile, an einer Wortgrenze gekürzt. */
export function titleFromText(text: string, max = SHARE_TITLE_MAX): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  // Ohne sinnvolle Wortgrenze (z. B. eine lange URL) hart kürzen.
  return `${(space >= max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** `null`, wenn nichts Brauchbares geteilt wurde. */
export function taskFromShare(data: SharedData): { title: string; notes: string } | null {
  const title = clean(data.title);
  const text = clean(data.text);
  const url = clean(data.url);

  const notes = [text, url !== '' && !text.includes(url) ? url : ''].filter((part) => part !== '').join('\n\n');
  const firstFile = clean(data.files?.find((name) => clean(name) !== ''));
  const derived = title !== '' ? title : notes !== '' ? titleFromText(notes) : titleFromText(firstFile);
  if (derived === '') return null;
  return { title: derived, notes };
}
