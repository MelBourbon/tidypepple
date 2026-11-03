/**
 * Vorschläge beim Erfassen: Wer `@bu` tippt, soll `@büro` wählen können, statt aus Versehen
 * einen zweiten Kontext `@buero` anzulegen. Die Erfassung legt fehlende Namen bewusst
 * kommentarlos an (kein Rückfrage-Dialog im Erfassungsfluss) – umso wichtiger ist, dass
 * die vorhandenen beim Tippen sichtbar sind.
 *
 * Rein und ohne React, damit die Regeln testbar sind.
 */

export type SuggestMarker = '@' | '+' | '#';

/** Das Token, an dessen Ende der Cursor steht – nur wenn es mit einem Marker beginnt. */
export interface ActiveToken {
  marker: SuggestMarker;
  /** Was nach dem Marker getippt ist, ohne Marker. */
  query: string;
  /** Position des Markers im Eingabetext. */
  start: number;
  /** Position direkt hinter dem Token (= Cursor). */
  end: number;
}

const MARKERS: readonly string[] = ['@', '+', '#'];

/**
 * Nur am *Ende* eines Tokens: Steht der Cursor mitten in `@büro`, bearbeitet man gerade
 * etwas, statt einen Namen zu suchen.
 */
export function activeToken(value: string, caret: number): ActiveToken | null {
  if (caret < 1 || caret > value.length) return null;
  const after = value[caret];
  if (after !== undefined && !/\s/.test(after)) return null;
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1]!)) start--;
  const marker = value[start];
  if (marker === undefined || !MARKERS.includes(marker)) return null;
  return { marker: marker as SuggestMarker, query: value.slice(start + 1, caret), start, end: caret };
}

/**
 * Vergleichsschlüssel: ohne Groß-/Kleinschreibung, Umlaute in zwei Schreibweisen – wer auf
 * einer Tastatur ohne Umlaute `bue` oder `bu` tippt, findet beide Male „büro“.
 */
function keys(text: string): string[] {
  const lower = text.toLowerCase();
  const spelled = lower.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const stripped = lower.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
  return [spelled, stripped];
}

/**
 * Passende Namen: erst die, die mit der Eingabe beginnen, dann die, die sie enthalten –
 * jeweils in der gegebenen Reihenfolge. Ein Name, der schon genau dasteht, braucht keinen
 * Vorschlag mehr.
 */
export function suggest(names: readonly string[], query: string, limit = 6): string[] {
  const q = keys(query);
  const exact = query.toLowerCase();
  const prefix: string[] = [];
  const inner: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    // Zwei Projekte gleichen Namens sind für die Erfassung eins (`ensureProject` nimmt das erste).
    if (lower === exact || seen.has(lower)) continue;
    seen.add(lower);
    const k = keys(name);
    if (k.some((key) => q.some((part) => key.startsWith(part)))) prefix.push(name);
    else if (q[0] !== '' && k.some((key) => q.some((part) => key.includes(part)))) inner.push(name);
  }
  return [...prefix, ...inner].slice(0, limit);
}

/** So steht ein Name im Erfassungsfeld: Projekte mit `_` statt Leerzeichen (siehe `parseQuickAdd`). */
export function tokenFor(marker: SuggestMarker, name: string): string {
  return `${marker}${marker === '+' ? name.replace(/\s+/g, '_') : name}`;
}

/**
 * Nur vorschlagen, was als Token getippt auch wieder genau diesen Namen ergibt:
 * Kontexte und Tags ohne Leerzeichen; Projekte mit Buchstaben und ohne `_` (den liest
 * `parseQuickAdd` als Leerzeichen – „foo_bar“ würde zu einem neuen Projekt „foo bar“).
 */
export function isTypeable(marker: SuggestMarker, name: string): boolean {
  if (marker === '+') return /\p{L}/u.test(name) && !name.includes('_');
  return name !== '' && !/\s/.test(name);
}

/** Wonach gesucht wird: bei Projekten steht `_` für ein Leerzeichen, wie im Parser. */
export function searchText(token: ActiveToken): string {
  return token.marker === '+' ? token.query.replace(/_/g, ' ') : token.query;
}

/** Ersetzt das aktive Token durch den gewählten Namen, mit Leerzeichen dahinter für das nächste Wort. */
export function applySuggestion(
  value: string,
  token: ActiveToken,
  name: string,
): { value: string; caret: number } {
  const rest = value.slice(token.end);
  const inserted = `${tokenFor(token.marker, name)}${rest.startsWith(' ') ? '' : ' '}`;
  const next = value.slice(0, token.start) + inserted + rest;
  return { value: next, caret: token.start + inserted.length + (rest.startsWith(' ') ? 1 : 0) };
}

/** Gibt es den Namen schon? Groß-/Kleinschreibung zählt nicht – wie beim Anlegen. */
export function isKnown(names: readonly string[], name: string): boolean {
  const key = name.toLowerCase();
  return names.some((n) => n.toLowerCase() === key);
}
