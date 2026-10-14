import { useEffect, useState } from 'react';
import { useOutboxCount } from '@/data/hooks';
import { useSync } from '@/sync/SyncProvider';
import { t } from '@/i18n';

/**
 * Sichtbarkeit des Systemzustands (Nielsen #1), aber leise: eine Zeile, kein Spinner.
 * Solange kein Sync eingerichtet ist, sagt die App das ehrlich – "Synchron" wäre
 * irreführend, wenn es gar kein Gegenüber gibt.
 */
export function SyncIndicator(): React.ReactNode {
  const { state } = useSync();
  const pending = useOutboxCount();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const { label, tone } = describe(state, online, pending);

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

function describe(
  state: ReturnType<typeof useSync>['state'],
  online: boolean,
  pending: number,
): { label: string; tone: string } {
  if (state === 'unconfigured') return { label: t.sync.localOnly, tone: 'bg-subtle' };
  if (state === 'signed-out') return { label: t.sync.signedOut, tone: 'bg-subtle' };
  if (state === 'locked' || state === 'needs-vault') return { label: t.sync.locked, tone: 'bg-danger' };
  if (!online) return { label: t.sync.offline, tone: 'bg-warn-dot' };
  // Ohne Abo wird weiterhin heruntergeladen. "Synchron" wäre hier gelogen, denn die
  // eigenen Änderungen liegen noch in der Outbox.
  if (state === 'needs-subscription') return { label: t.sync.readOnly, tone: 'bg-warn-dot' };
  if (pending > 0) return { label: t.sync.pending(pending), tone: 'bg-accent' };
  return { label: t.sync.synced, tone: 'bg-accent/50' };
}
