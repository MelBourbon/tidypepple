import { formatDueLabel } from '@/domain/dates';
import { hasPendingReminder } from '@/domain/reminders';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';

/** Glocke mit Tag und Uhrzeit, solange eine Erinnerung aussteht. Vergangene zeigt sie nicht mehr. */
export function ReminderBadge({ task }: { task: Task }): React.ReactNode {
  if (task.reminderAt === null || !hasPendingReminder(task, Date.now())) return null;
  const [date = '', time = ''] = task.reminderAt.split('T');
  const day = formatDueLabel(date, { ...t.due, weekdaysShort: t.weekdaysShort, dateLocale: t.dateLocale });
  const label = `${day} ${time}`;

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted tabular-nums" title={t.task.reminderBadge(label)}>
      {/* Glocke (Lucide „bell", ISC-Lizenz) */}
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.268 21a2 2 0 0 0 3.464 0" />
        <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
      </svg>
      <span className="sr-only">{t.task.reminder}: </span>
      {label}
    </span>
  );
}
