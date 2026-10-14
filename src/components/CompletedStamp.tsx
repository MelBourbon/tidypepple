import { formatTimestamp } from '@/domain/dates';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';

/** Kleiner Hinweis, wann eine erledigte Aufgabe abgehakt wurde. Offene zeigen nichts. */
export function CompletedStamp({ task, className = '' }: { task: Task; className?: string }): React.ReactNode {
  if (task.status !== 'done' || task.completedAt === null) return null;
  const when = formatTimestamp(task.completedAt, t.dateLocale);
  return (
    <time dateTime={new Date(task.completedAt).toISOString()} className={`text-xs text-muted tabular-nums ${className}`}>
      {t.task.completedAt(when)}
    </time>
  );
}
