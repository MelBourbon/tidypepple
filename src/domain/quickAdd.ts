import { addDays, toIsoDate, today } from './dates';
import { cleanTagName, withTag } from './tags';
import type { IsoDate } from './types';

/**
 * Erfassen soll ein einziges Textfeld sein – GTD lebt davon, dass Capture keine
 * Reibung hat. Die Syntax ist deshalb optional und additiv:
 *
 *     Bob anrufen @telefon +Umzug #steuer !morgen >mo !!
 *     └ Titel ──┘ └Kontext┘ └Proj.┘ └ Tag ─┘ └fällig┘ └ab┘ └wichtig┘
 *
 * Projekte hatten früher `#`; seit es Tags gibt, gehört `#` den Tags – wie
 * überall sonst – und Projekte bekommen `+` wie in todo.txt.
 */

export interface QuickAddResult {
  title: string;
  contextNames: readonly string[];
  projectName: string | null;
  tagNames: readonly string[];
  dueDate: IsoDate | null;
  deferDate: IsoDate | null;
  highPriority: boolean;
  /**
   * `!…`- und `>…`-Tokens, die wie ein Datum gemeint waren, aber keins sind. Sie bleiben im
   * Titel – die Erfassung soll nie scheitern –, die Vorschau weist aber auf sie hin.
   */
  unrecognized: readonly string[];
}

/** Wohin eine Erfassung geht: Inbox, Next oder als Schritt in ein Projekt. */
export type CaptureDestination = 'inbox' | 'next' | 'project';

/**
 * Wer beim Erfassen schon Kontext oder Datum angibt, hat die Aufgabe geklärt – sie geht
 * direkt in Next. Die Priorität allein klärt nichts: wichtig heißt noch nicht, dass klar
 * ist, was zu tun ist. Eine Quelle für die Erfassung selbst und für ihre Vorschau.
 */
export function captureDestination(parsed: QuickAddResult): CaptureDestination {
  if (parsed.projectName !== null) return 'project';
  return parsed.contextNames.length > 0 || parsed.dueDate !== null ? 'next' : 'inbox';
}

// Deutsch und Englisch gelten immer, unabhängig von der Sprache der Oberfläche: Die Kürzel
// überschneiden sich nicht, und wer beide Sprachen spricht, tippt mal so und mal so.
const WEEKDAY_ALIASES: Record<string, number> = {
  so: 0, sonntag: 0, sun: 0, sunday: 0,
  mo: 1, montag: 1, mon: 1, monday: 1,
  di: 2, dienstag: 2, tue: 2, tues: 2, tuesday: 2,
  mi: 3, mittwoch: 3, wed: 3, wednesday: 3,
  do: 4, donnerstag: 4, thu: 4, thurs: 4, thursday: 4,
  fr: 5, freitag: 5, fri: 5, friday: 5,
  sa: 6, samstag: 6, sat: 6, saturday: 6,
};

/** Nächstes Vorkommen dieses Wochentags, immer in der Zukunft (heute zählt nicht). */
function nextWeekday(target: number, ref: IsoDate): IsoDate {
  const [y, m, d] = ref.split('-').map(Number) as [number, number, number];
  const delta = ((target - new Date(y, m - 1, d).getDay() + 7) % 7) || 7;
  return addDays(ref, delta);
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** `heute`/`today`, `morgen`/`tomorrow`, `mo`/`mon`, `2026-10-01`, `1.10.`, `1.10`, `1.10.2026` – sonst `null`. */
export function parseDateToken(token: string, ref: IsoDate = today()): IsoDate | null {
  const raw = token.trim().toLowerCase();
  if (raw === '') return null;

  if (raw === 'heute' || raw === 'today') return ref;
  if (raw === 'morgen' || raw === 'tomorrow' || raw === 'tmrw') return addDays(ref, 1);
  if (raw === 'übermorgen' || raw === 'uebermorgen') return addDays(ref, 2);
  if (raw === 'nächstewoche' || raw === 'naechstewoche' || raw === 'nextweek') return addDays(ref, 7);

  const weekday = WEEKDAY_ALIASES[raw];
  if (weekday !== undefined) return nextWeekday(weekday, ref);

  // In n Tagen: "+3"
  const plus = /^\+(\d+)$/.exec(raw);
  if (plus) return addDays(ref, Number(plus[1]));

  // ISO: 2026-10-01
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return isValidDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? raw : null;

  // Deutsch: 1.10. / 1.10 / 01.10.2026 – der Schlusspunkt wird gern vergessen.
  const german = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4})?)?$/.exec(raw);
  if (german) {
    const day = Number(german[1]);
    const month = Number(german[2]);
    // Kein stilles Überlaufen: "31.2." wäre sonst der 3. März.
    if (german[3] !== undefined) {
      const year = Number(german[3]);
      return isValidDate(year, month, day) ? toIsoDate(new Date(year, month - 1, day)) : null;
    }
    // Ohne Jahresangabe das nächste Vorkommen ab heute. Für den 29.2. kann das bis zu acht
    // Jahre entfernt sein (1900 und 2100 sind keine Schaltjahre), sonst höchstens eins.
    const refYear = Number(ref.slice(0, 4));
    for (let year = refYear; year <= refYear + 8; year++) {
      if (!isValidDate(year, month, day)) continue;
      const candidate = toIsoDate(new Date(year, month - 1, day));
      if (candidate >= ref) return candidate;
    }
    return null;
  }

  return null;
}

export function parseQuickAdd(input: string, ref: IsoDate = today()): QuickAddResult {
  const contextNames: string[] = [];
  const titleParts: string[] = [];
  let projectName: string | null = null;
  let tagNames: string[] = [];
  let dueDate: IsoDate | null = null;
  let deferDate: IsoDate | null = null;
  let highPriority = false;
  const unrecognized: string[] = [];

  for (const token of input.split(/\s+/)) {
    if (token === '') continue;
    const marker = token[0]!;
    const value = token.slice(1);

    // `!!` allein, damit "Achtung!!" im Titel nicht als Markierung gelesen wird.
    if (token === '!!') {
      highPriority = true;
      continue;
    }
    // Ein Marker greift nur, wenn er am Tokenanfang steht – "bob@example.com" bleibt Titel.
    if (marker === '@' && value !== '') {
      contextNames.push(value);
      continue;
    }
    // Projekt und Tag brauchen einen Buchstaben: "+49 30 …" und "Ticket #123" bleiben Titel.
    if (marker === '+' && /\p{L}/u.test(value)) {
      projectName = value.replace(/_/g, ' ');
      continue;
    }
    if (marker === '#' && cleanTagName(value) !== null) {
      tagNames = withTag(tagNames, value);
      continue;
    }
    if (marker === '!' && value !== '') {
      const parsed = parseDateToken(value, ref);
      if (parsed !== null) {
        dueDate = parsed;
        continue;
      }
    }
    if (marker === '>' && value !== '') {
      const parsed = parseDateToken(value, ref);
      if (parsed !== null) {
        deferDate = parsed;
        continue;
      }
    }
    // Nur was wie ein Datumsversuch aussieht: ein Wort ("!freitags") oder Ziffern mit Punkt
    // bzw. Strich ("!32.1."). "!?", ">>" und Vergleiche wie ">5" bleiben unkommentiert.
    if ((marker === '!' || marker === '>') && /^(?:\p{L}|\d+[.-]\d)/u.test(value)) unrecognized.push(token);
    titleParts.push(token);
  }

  return { title: titleParts.join(' ').trim(), contextNames, projectName, tagNames, dueDate, deferDate, highPriority, unrecognized };
}
