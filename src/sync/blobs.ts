import type { BlobAdapter, BlobUploadStatus } from './adapter';
import type { VaultAccess } from './engine';
import { openFile, sealFile } from '@/crypto/attachment';
import { db, type BlobQueueEntry } from '@/data/db';
import type { Attachment, Task } from '@/domain/types';

/**
 * Anhang-Dateien zwischen Gerät und Server abgleichen.
 *
 * Hochladen und Löschen laufen über `db.blobQueue`, Herunterladen nur auf Anfrage: ein
 * zweites Gerät lädt eine Datei erst, wenn jemand die Aufgabe öffnet. Alles vorab zu
 * holen hieße bis zu 200 MB auf jedes Handy.
 */

export interface BlobSyncResult {
  uploaded: number;
  removed: number;
  /** Warum nicht hochgeladen wurde – `null`, wenn es ging oder nichts anstand. */
  blocked: Exclude<BlobUploadStatus, 'ok'> | null;
}

export type FetchResult = 'ok' | 'missing';

const pathOf = (taskId: string, attachmentId: string): string => `${taskId}/${attachmentId}`;

/** Anhang-ID → Aufgabe, über alle Aufgaben einschließlich Tombstones (die kann Undo zurückholen). */
const referencedAttachments = (tasks: readonly Task[]): Map<string, string> =>
  new Map(tasks.flatMap((task) => task.attachments.map((a) => [a.id, task.id] as const)));

/**
 * Eintrag nur entfernen, wenn er noch derselbe ist. Wurde währenddessen aus dem Löschen
 * ein Hochladen (Undo) oder umgekehrt, muss der neue Auftrag stehen bleiben.
 */
async function finish(entry: BlobQueueEntry): Promise<void> {
  await db.transaction('rw', db.blobQueue, async () => {
    const current = await db.blobQueue.get(entry.id);
    if (current?.op === entry.op) await db.blobQueue.delete(entry.id);
  });
}

export class BlobSync {
  constructor(
    private readonly adapter: BlobAdapter,
    private readonly vault: VaultAccess,
  ) {}

  async run(): Promise<BlobSyncResult> {
    const entries = await db.blobQueue.toArray();
    if (entries.length === 0) return { uploaded: 0, removed: 0, blocked: null };
    const referenced = referencedAttachments(await db.tasks.toArray());

    const uploads = entries.filter((e) => e.op === 'upload');
    let uploaded = 0;
    let blocked: BlobSyncResult['blocked'] = null;
    if (uploads.length > 0) {
      const status = await this.adapter.uploadStatus();
      // Gesperrt: die Einträge bleiben stehen und gehen nach Abschluss bzw. Aufräumen raus.
      if (status !== 'ok') blocked = status;
      else {
        for (const entry of uploads) {
          const blob = referenced.has(entry.id) ? await db.blobs.get(entry.id) : undefined;
          if (blob !== undefined) {
            const sealed = await sealFile(this.vault.key(), this.vault.keyVersion(), entry.id, blob.data);
            await this.adapter.upload(pathOf(entry.taskId, entry.id), sealed);
            uploaded += 1;
          }
          // Ohne Verweis oder ohne Datei gibt es nichts hochzuladen.
          await finish(entry);
        }
      }
    }

    // Nur löschen, was bis jetzt nicht wieder eingetragen wurde.
    const deletes = entries.filter((e) => e.op === 'delete');
    const gone = deletes.filter((e) => !referenced.has(e.id));
    if (gone.length > 0) await this.adapter.remove(gone.map((e) => pathOf(e.taskId, e.id)));
    for (const entry of deletes) await finish(entry);

    return { uploaded, removed: gone.length, blocked };
  }

  /** Lädt eine Datei, die auf diesem Gerät fehlt, und legt sie lokal ab. */
  async fetch(taskId: string, attachment: Attachment): Promise<FetchResult> {
    const sealed = await this.adapter.download(pathOf(taskId, attachment.id));
    if (sealed === null) return 'missing';
    const data = await openFile(this.vault.key(), attachment.id, sealed);
    await db.blobs.put({ id: attachment.id, data });
    return 'ok';
  }
}
