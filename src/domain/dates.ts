import type { IsoDate } from './types';

/** Lokales Datum als 'YYYY-MM-DD'. Bewusst lokal, nicht UTC: "heute" ist eine Nutzersicht. */
export function toIsoDate(d: Date = new Date()): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): IsoDate {
  return toIsoDate();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return toIsoDate(new Date(y, m - 1, d + days));
}

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

export function dueBucket(due: IsoDate | null, ref: IsoDate = today()): DueBucket {
  if (due === null) return 'none';
  if (due < ref) return 'overdue';
  if (due === ref) return 'today';
  if (due === addDays(ref, 1)) return 'tomorrow';
  if (due <= addDays(ref, 7)) return 'week';
  return 'later';
}

/** Die Texte kommen von außen – die Domain kennt keine Sprache. */
export interface DueLabels {
  today: string;
  tomorrow: string;
  /** Sonntag zuerst, wie `Date.getDay()`. */
  weekdaysShort: readonly string[];
  /** Für `toLocaleDateString`, z. B. 'de-DE'. */
  dateLocale: string;
}

/** Kurzlabel für Badges: „Heute", „Morgen", „Do", sonst „3. Okt". */
export function formatDueLabel(due: IsoDate, labels: DueLabels, ref: IsoDate = today()): string {
  const bucket = dueBucket(due, ref);
  if (bucket === 'today') return labels.today;
  if (bucket === 'tomorrow') return labels.tomorrow;
  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  if (bucket === 'week') return labels.weekdaysShort[date.getDay()]!;
  return date.toLocaleDateString(labels.dateLocale, { day: 'numeric', month: 'short' });
}

/** Zeitpunkt mit Uhrzeit für kleine Hinweise: „8. Okt., 14:32", aus anderen Jahren mit Jahr. */
export function formatTimestamp(ms: number, dateLocale: string, now: Date = new Date()): string {
  const date = new Date(ms);
  return date.toLocaleString(dateLocale, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}
