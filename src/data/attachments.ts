import { db } from './db';
import { addAttachmentMeta, removeAttachmentMeta } from './repo';
import { checkAttachment, orphanBlobIds, usedBytes, type AttachmentProblem } from '@/domain/attachments';
import { uuidv7 } from '@/domain/ids';
import type { Attachment } from '@/domain/types';

/**
 * Anhänge speichern. Die Datei liegt lokal; den Weg zum Server übernimmt
 * `BlobSync` über `db.blobQueue`, sobald synchronisiert wird.
 *
 * Erst die Datei, dann die Metadaten: bricht dazwischen etwas ab, bleibt höchstens eine
 * Datei ohne Verweis zurück, und die räumt `purgeOrphanBlobs` beim nächsten Start weg.
 * Umgekehrt stünde ein Anhang an der Aufgabe, dessen Datei fehlt.
 */
export async function addAttachment(
  taskId: string,
  file: { name: string; type: string; data: ArrayBuffer },
): Promise<AttachmentProblem | null> {
  const problem = checkAttachment({ type: file.type, size: file.data.byteLength }, usedBytes(await db.tasks.toArray()));
  if (problem !== null) return problem;

  const attachment: Attachment = {
    id: uuidv7(Date.now()),
    name: file.name,
    type: file.type,
    size: file.data.byteLength,
    addedAt: Date.now(),
  };
  await db.blobs.put({ id: attachment.id, data: file.data });
  await addAttachmentMeta(taskId, attachment);
  await db.blobQueue.put({ id: attachment.id, taskId, op: 'upload' });
  return null;
}

/**
 * Entfernt nur den Verweis; die Datei bleibt bis zum nächsten Start liegen. So kann der
 * Undo-Toast den Anhang einfach wieder eintragen.
 *
 * Auf dem Server wird sie beim nächsten Sync gelöscht – es sei denn, der Anhang ist bis
 * dahin wieder eingetragen. Das prüft `BlobSync` erst unmittelbar vor dem Löschen.
 */
export async function removeAttachment(taskId: string, attachmentId: string): Promise<void> {
  await removeAttachmentMeta(taskId, attachmentId);
  await db.blobQueue.put({ id: attachmentId, taskId, op: 'delete' });
}

/** Undo: ein bereits eingetragenes Löschen wird wieder zum (idempotenten) Hochladen. */
export async function restoreAttachment(taskId: string, attachment: Attachment): Promise<void> {
  await addAttachmentMeta(taskId, attachment);
  await db.blobQueue.put({ id: attachment.id, taskId, op: 'upload' });
}

export async function purgeOrphanBlobs(): Promise<number> {
  const orphans = orphanBlobIds(await db.tasks.toArray(), (await db.blobs.toCollection().primaryKeys()) as string[]);
  await db.blobs.bulkDelete(orphans);
  return orphans.length;
}
