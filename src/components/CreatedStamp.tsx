import { daysSince, formatDay } from '@/domain/dates';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Wann eine Aufgabe erfasst wurde und wie alt sie ist – hilft beim Weekly Review zu
 * entscheiden, ob sie nach „Irgendwann“ gehört oder weg kann. Nur im Detail, die Liste
 * bleibt ruhig. Ältere Daten ohne Zeitpunkt (`0`) zeigen nichts.
 */
export function CreatedStamp({ task, className = '' }: { task: Task; className?: string }): React.ReactNode {
  if (task.createdAt <= 0) return null;
  const when = formatDay(task.createdAt, t.dateLocale);
  return (
    <time dateTime={new Date(task.createdAt).toISOString()} className={`text-xs text-muted tabular-nums ${className}`}>
      {t.task.createdAt(when, t.task.age(daysSince(task.createdAt)))}
    </time>
  );
}
