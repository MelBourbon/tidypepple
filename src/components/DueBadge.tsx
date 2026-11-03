import { dueBucket, formatDueLabel } from '@/domain/dates';
import type { IsoDate } from '@/domain/types';
import { t } from '@/i18n';

/** Kurzlabel eines Datums in der Sprache der Oberfläche: „Heute", „Do", „3. Okt". */
export function dueLabel(date: IsoDate): string {
  return formatDueLabel(date, { ...t.due, weekdaysShort: t.weekdaysShort, dateLocale: t.dateLocale });
}

/**
 * Fälligkeit als Badge. Bewusst eine Komponente für Liste *und* Board – so kann keine
 * Ansicht das Datum versehentlich weglassen.
 */
export function DueBadge({ due, time }: { due: IsoDate | null; time?: string | null }): React.ReactNode {
  if (due === null) return null;
  const bucket = dueBucket(due);
  const overdue = bucket === 'overdue';
  const text = dueLabel(due);
  const label = overdue ? `${t.due.overdue} · ${text}` : text;

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        overdue ? 'bg-danger-soft text-danger' : 'bg-raised text-muted',
      ].join(' ')}
      title={time == null ? due : `${due} ${time}`}
    >
      {label}
      {time != null && <span className="opacity-70">{time}</span>}
    </span>
  );
}
