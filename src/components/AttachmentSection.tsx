import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareAttachment } from './prepareAttachment';
import { useToast } from './Toast';
import { addAttachment, removeAttachment, restoreAttachment } from '@/data/attachments';
import { db } from '@/data/db';
import { formatBytes, isImage } from '@/domain/attachments';
import type { Attachment, Task } from '@/domain/types';
import { t } from '@/i18n';
import { useSync } from '@/sync/SyncProvider';
import { androidBridge } from '@/platform/android';

/** Zustand einer Datei, die auf diesem Gerät fehlt. */
type RemoteState = 'loading' | 'missing' | 'failed' | 'unavailable';

/**
 * Anhänge im Detail: Bilder als Kacheln, PDFs als Zeilen. Antippen öffnet die
 * Datei in einem neuen Tab – Browser und Betriebssystem können Bilder und PDFs besser
 * anzeigen als ein eigener Viewer. Die Android-App hat keine Tabs; dort reicht die Hülle
 * die Datei an eine passende App weiter.
 */
export function AttachmentSection({ task }: { task: Task }): React.ReactNode {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { urls, missing } = useObjectUrls(task.attachments);
  const remote = useRemoteFiles(task, missing);
  const images = task.attachments.filter(isImage);
  const files = task.attachments.filter((a) => !isImage(a));

  const openInApp = (attachment: Attachment) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    const bridge = androidBridge();
    if (bridge === null) return;
    event.preventDefault();
    const { href } = event.currentTarget;
    void fetch(href)
      .then((response) => response.blob())
      .then((blob) => bridge.openFile({ name: attachment.name, mimeType: attachment.type, content: blob }))
      .catch(() => toast({ message: t.attachments.openFailed }));
  };

  const add = async (list: FileList): Promise<void> => {
    setBusy(true);
    try {
      for (const file of [...list]) {
        const problem = await addAttachment(task.id, await prepareAttachment(file));
        if (problem !== null) toast({ message: t.attachments.problem[problem](file.name) });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (attachment: Attachment): Promise<void> => {
    await removeAttachment(task.id, attachment.id);
    toast({
      message: t.attachments.removed,
      action: { label: t.undo.action, onClick: () => void restoreAttachment(task.id, attachment) },
    });
  };

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-overline">{t.attachments.title}</h2>
        {/* Label statt gestyltem Dateifeld: bleibt ein echtes, tastaturbedienbares Formularelement. */}
        <label
          className={[
            'flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-line bg-surface px-3 text-xs transition-colors hover:bg-raised',
            busy ? 'pointer-events-none opacity-60' : '',
          ].join(' ')}
        >
          <span aria-hidden="true">+</span> {busy ? t.attachments.saving : t.attachments.add}
          <input
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const list = e.target.files;
              if (list !== null && list.length > 0) void add(list);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {images.length > 0 && (
        <ul className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((a) => (
            <li key={a.id} className="relative isolate aspect-square overflow-hidden rounded-md border border-line bg-raised">
              {urls.has(a.id) ? (
                <a href={urls.get(a.id)} target="_blank" rel="noopener" onClick={openInApp(a)} className="block size-full">
                  <img src={urls.get(a.id)} alt={a.name} className="size-full object-cover" />
                </a>
              ) : (
                remote.states.has(a.id) && (
                  <Missing name={a.name} state={remote.states.get(a.id)!} onRetry={() => void remote.load(a)} />
                )
              )}
              <RemoveButton attachment={a} onRemove={remove} className="absolute top-0 right-0" />
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-card border border-line bg-surface">
          {files.map((a) => (
            <li key={a.id} className="flex items-center gap-2 border-b border-line pl-3 last:border-b-0">
              <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5zM9 1.5V5h3.5" strokeLinejoin="round" />
              </svg>
              {urls.has(a.id) ? (
                <a
                  href={urls.get(a.id)}
                  target="_blank"
                  rel="noopener"
                  onClick={openInApp(a)}
                  className="min-w-0 flex-1 truncate py-2.5 text-sm hover:text-accent"
                >
                  {a.name}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate py-2.5 text-sm text-muted">
                  {a.name}
                  {remote.states.has(a.id) && ` · ${remoteLabel(remote.states.get(a.id)!)}`}
                </span>
              )}
              {!urls.has(a.id) && canRetry(remote.states.get(a.id)) && (
                <button type="button" onClick={() => void remote.load(a)} className="shrink-0 text-xs text-accent hover:underline">
                  {t.attachments.retry}
                </button>
              )}
              <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(a.size)}</span>
              <RemoveButton attachment={a} onRemove={remove} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">{t.attachments.hint}</p>
    </section>
  );
}

function RemoveButton({
  attachment,
  onRemove,
  className = '',
}: {
  attachment: Attachment;
  onRemove: (attachment: Attachment) => Promise<void>;
  className?: string;
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={() => void onRemove(attachment)}
      aria-label={`${t.attachments.remove}: ${attachment.name}`}
      className={['flex size-9 shrink-0 items-center justify-center text-muted hover:text-danger', className].join(' ')}
    >
      <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-surface/90 text-base leading-none">
        ×
      </span>
    </button>
  );
}

const remoteLabel = (state: RemoteState): string =>
  ({
    loading: t.attachments.loading,
    missing: t.attachments.notUploaded,
    failed: t.attachments.loadFailed,
    unavailable: t.attachments.missing,
  })[state];

const canRetry = (state: RemoteState | undefined): boolean => state === 'missing' || state === 'failed';

/**
 * Metadaten da, Datei nicht: kommt über Sync oder Sicherung von einem anderen Gerät. Mit
 * Sync wird sie nachgeladen; "noch nicht hochgeladen" heißt, das andere Gerät ist noch dran.
 */
function Missing({ name, state, onRetry }: { name: string; state: RemoteState; onRetry: () => void }): React.ReactNode {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center" title={name}>
      <span className="text-xs text-muted">{remoteLabel(state)}</span>
      {canRetry(state) && (
        <button type="button" onClick={onRetry} className="relative z-10 text-xs text-accent hover:underline">
          {t.attachments.retry}
        </button>
      )}
    </div>
  );
}

/**
 * Fehlende Dateien vom Server holen – einmal von selbst, danach auf Knopfdruck. Wird der
 * Sync erst nach dem Öffnen bereit (App-Start), gilt das als neuer Anlauf.
 */
function useRemoteFiles(
  task: Task,
  missing: readonly string[],
): { states: ReadonlyMap<string, RemoteState>; load: (a: Attachment) => Promise<void> } {
  const sync = useSync();
  const [states, setStates] = useState<ReadonlyMap<string, RemoteState>>(new Map());
  const tried = useRef(new Set<string>());
  const set = (id: string, state: RemoteState | null): void =>
    setStates((prev) => {
      const next = new Map(prev);
      if (state === null) next.delete(id);
      else next.set(id, state);
      return next;
    });

  const load = async (attachment: Attachment): Promise<void> => {
    set(attachment.id, 'loading');
    try {
      const result = await sync.fetchAttachment(task.id, attachment);
      // Bei Erfolg zeigt die Live-Abfrage die Datei; der Zustand wird nicht mehr gebraucht.
      set(attachment.id, result === 'ok' ? null : result);
    } catch {
      set(attachment.id, 'failed');
    }
  };

  const key = `${missing.join(',')}|${sync.canFetchAttachments}`;
  useEffect(() => {
    for (const id of missing) {
      const attempt = `${id}|${sync.canFetchAttachments}`;
      if (tried.current.has(attempt)) continue;
      tried.current.add(attempt);
      const attachment = task.attachments.find((a) => a.id === id);
      if (attachment !== undefined) void load(attachment);
    }
    // `key` fasst die fehlenden Dateien und die Erreichbarkeit zusammen.
  }, [key]);

  return { states, load };
}

/**
 * Object-URLs für die Dateien dieser Aufgabe. Sie werden beim Wechsel wieder freigegeben –
 * sonst hielte jede geöffnete Aufgabe ihre Dateien bis zum Neuladen im Speicher.
 *
 * `missing`: Anhänge, deren Datei nicht auf dem Gerät liegt – direkt aus der Abfrage, nicht
 * aus den URLs, die erst einen Effekt später stehen.
 */
function useObjectUrls(attachments: readonly Attachment[]): { urls: ReadonlyMap<string, string>; missing: readonly string[] } {
  const key = attachments.map((a) => a.id).join(',');
  const ids = useMemo(() => (key === '' ? [] : key.split(',')), [key]);
  // Das Ergebnis trägt mit, zu welchen IDs es gehört: bis die neue Abfrage liefert, gibt
  // `useLiveQuery` das alte zurück, und ein gerade angehängtes Bild sähe fehlend aus.
  const result = useLiveQuery(async () => ({ key, rows: await db.blobs.bulkGet(ids) }), [ids]);
  const rows = result?.key === key ? result.rows : undefined;
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());

  const missing = useMemo(() => (rows === undefined ? [] : ids.filter((_, i) => rows[i] === undefined)), [rows, ids]);

  useEffect(() => {
    if (rows === undefined) return;
    const types = new Map(attachments.map((a) => [a.id, a.type]));
    const next = new Map<string, string>();
    for (const row of rows) {
      if (row !== undefined) next.set(row.id, URL.createObjectURL(new Blob([row.data], { type: types.get(row.id) ?? '' })));
    }
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
    // `attachments` liefert nur die Typen; neu gebaut wird, wenn sich die Dateien ändern.
  }, [rows]);

  return { urls, missing };
}
