import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, getMeta, META_KEYS, setMeta } from '@/data/db';
import { isLive } from '@/domain/types';
import { useSync, type SyncState } from '@/sync/SyncProvider';
import { t } from '@/i18n';
import { platform } from '@/platform';

/** Nur hier liegen die Daten ausschließlich im Browser. `loading` wartet ab, statt kurz aufzublitzen. */
const LOCAL_ONLY_STATES = new Set<SyncState>(['unconfigured', 'signed-out']);

/**
 * Einmaliger Hinweis, dass ohne Synchronisation alles nur im Browser liegt.
 *
 * Erst sobald es eine eigene Aufgabe gibt – vorher ist nichts zu verlieren. Der Merker liegt
 * bewusst in derselben IndexedDB wie die Aufgaben: wer die Browserdaten löscht, verliert
 * beides und bekommt den Hinweis genau dann wieder, wenn er erneut stimmt.
 */
export function StorageNotice(): ReactNode {
  const { state } = useSync();
  // Eine Abfrage über beide Tabellen: jede Änderung an Aufgaben liest den Merker neu.
  const due = useLiveQuery(
    async () => (await getMeta<boolean>(META_KEYS.storageNoticeSeen)) !== true && (await db.tasks.filter(isLive).first()) !== undefined,
    [],
    false,
  );

  if (!due || !LOCAL_ONLY_STATES.has(state)) return null;

  const dismiss = (): void => void setMeta(META_KEYS.storageNoticeSeen, true);
  // In der Android-App liegen die Daten im App-Speicher, nicht im Browser.
  const inApp = platform() === 'android';
  const title = inApp ? t.storageNotice.titleApp : t.storageNotice.title;

  return (
    <aside
      aria-label={title}
      className="mt-2 rounded-card border border-line bg-surface px-4 py-3 text-sm"
    >
      <p className="text-heading-14">{title}</p>
      <p className="mt-1 text-muted">{inApp ? t.storageNotice.bodyApp : t.storageNotice.body}</p>
      <div className="mt-2 flex items-center gap-4">
        <Link to="/settings" onClick={dismiss} className="font-medium text-accent hover:underline">
          {t.storageNotice.backup}
        </Link>
        <button type="button" onClick={dismiss} className="text-muted hover:text-ink">
          {t.storageNotice.dismiss}
        </button>
      </div>
    </aside>
  );
}
