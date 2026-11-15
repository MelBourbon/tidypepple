import { MAX_NOTES_LENGTH } from './types';

/**
 * Kleine Checklisten leben in den Notizen, als Markdown-Aufgabenzeilen `- [ ] Milch`.
 * Kein eigenes Feld: Sync, Suche, Sicherung und MCP kennen die Notizen schon, und eine
 * ältere App-Version zeigt einfach den Text. Wer mehr braucht als Abhaken, macht ein Projekt.
 */

const CHECK_LINE = /^(\s*[-*] \[)([ xX])(\](?: |$))(.*)$/;

export type NoteSegment =
  | { kind: 'item'; line: number; done: boolean; text: string }
  | { kind: 'text'; text: string };

/** Zeilen samt ihrem Umbruch – so bleibt beim Zurückschreiben jedes `\r\n` erhalten. */
const splitLines = (notes: string): string[] => notes.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const stripBreak = (line: string): string => line.replace(/\r?\n$/, '');

/** Punkte und Textblöcke in der Reihenfolge der Notizen. */
export function parseNotes(notes: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let text: string[] = [];
  const flushText = (): void => {
    const block = text.join('\n');
    if (block.trim() !== '') segments.push({ kind: 'text', text: block });
    text = [];
  };
  splitLines(notes).forEach((raw, line) => {
    const content = stripBreak(raw);
    const match = CHECK_LINE.exec(content);
    if (match === null) {
      text.push(content);
      return;
    }
    flushText();
    segments.push({ kind: 'item', line, done: match[2] !== ' ', text: match[4] ?? '' });
  });
  flushText();
  return segments;
}

export function hasChecklist(notes: string): boolean {
  return splitLines(notes).some((raw) => CHECK_LINE.test(stripBreak(raw)));
}

/** Erledigte und alle Punkte, oder `null`, wenn die Notizen keine Checkliste tragen. */
export function checklistProgress(notes: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const raw of splitLines(notes)) {
    const match = CHECK_LINE.exec(stripBreak(raw));
    if (match === null) continue;
    total += 1;
    if (match[2] !== ' ') done += 1;
  }
  return total === 0 ? null : { done, total };
}

/** Kippt `[ ]` ↔ `[x]` in genau dieser Zeile; alles andere bleibt Zeichen für Zeichen gleich. */
export function toggleItem(notes: string, line: number): string {
  const lines = splitLines(notes);
  const raw = lines[line];
  if (raw === undefined) return notes;
  const ending = raw.slice(stripBreak(raw).length);
  const match = CHECK_LINE.exec(stripBreak(raw));
  if (match === null) return notes;
  const mark = match[2] === ' ' ? 'x' : ' ';
  lines[line] = `${match[1]}${mark}${match[3]}${match[4]}${ending}`;
  return lines.join('');
}

/** Hängt einen offenen Punkt ans Ende. Leerer Text oder volle Notizen ändern nichts. */
export function appendItem(notes: string, text: string): string {
  const item = text.replace(/\s+/g, ' ').trim();
  if (item === '') return notes;
  const separator = notes === '' || notes.endsWith('\n') ? '' : '\n';
  const next = `${notes}${separator}- [ ] ${item}`;
  return next.length > MAX_NOTES_LENGTH ? notes : next;
}
