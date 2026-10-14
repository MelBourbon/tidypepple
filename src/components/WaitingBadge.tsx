import type { Task } from '@/domain/types';
import { isFollowUpDue, waitingDays } from '@/domain/waiting';
import { t } from '@/i18n';

/**
 * Worauf eine Aufgabe wartet und wie lange schon. Ist die Frist erreicht,
 * wird daraus der Nachfass-Hinweis – so steht sie dann auch in "Next".
 */
export function WaitingBadge({ task }: { task: Task }): React.ReactNode {
  if (task.status !== 'waiting') return null;
  const followUp = isFollowUpDue(task);
  const days = waitingDays(task.waitingSince);
  const who = task.waitingFor?.trim() || null;

  const head = followUp
    ? who === null ? t.waiting.followUp : t.waiting.followUpWith(who)
    : who === null ? t.waiting.label : t.waiting.on(who);

  return (
    <span
      className={[
        // Nie breiter als die Karte – im Board ist die Spalte schmaler als 16rem.
        'inline-flex max-w-[min(16rem,100%)] min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        followUp ? 'bg-accent-soft font-medium text-accent' : 'bg-raised text-muted',
      ].join(' ')}
    >
      <span className="truncate">{head}</span>
      {days !== null && <span className="shrink-0 tabular-nums opacity-70">· {t.waiting.since(days)}</span>}
    </span>
  );
}
