import type { Attachment, Task } from './types';

/**
 * Regeln für Anhänge. Die Grenzen gelten für das, was gespeichert wird – Fotos
 * werden vorher verkleinert, ein 8-MB-Handyfoto passt also meist.
 */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_QUOTA_BYTES = 200 * 1024 * 1024;

/** Längere Kante, auf die Fotos verkleinert werden. Screenshots liegen meist darunter. */
export const IMAGE_MAX_EDGE = 2560;

/** Nur was die App auch anzeigen kann. Bilder, die der Browser nicht dekodiert, bleiben unverändert. */
export const isAllowedType = (type: string): boolean => type.startsWith('image/') || type === 'application/pdf';

export const isImage = (attachment: Pick<Attachment, 'type'>): boolean => attachment.type.startsWith('image/');

/**
 * Belegter Platz: Anhänge aller Aufgaben, die nicht gelöscht sind. Gelöschte zählen nicht
 * mehr, obwohl ihre Dateien bis zum Aufräumen noch da sind – sonst gäbe Löschen erst nach
 * Monaten Platz frei.
 */
export function usedBytes(tasks: readonly Task[]): number {
  return tasks
    .filter((task) => task.deletedAt === null)
    .reduce((sum, task) => sum + task.attachments.reduce((s, a) => s + a.size, 0), 0);
}

export type AttachmentProblem = 'type' | 'size' | 'quota';

export function checkAttachment(file: { type: string; size: number }, used: number): AttachmentProblem | null {
  if (!isAllowedType(file.type)) return 'type';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'size';
  if (used + file.size > ATTACHMENT_QUOTA_BYTES) return 'quota';
  return null;
}

/** Zielmaße beim Verkleinern; `null`, wenn das Bild schon klein genug ist. */
export function scaledSize(width: number, height: number, maxEdge = IMAGE_MAX_EDGE): { width: number; height: number } | null {
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return null;
  const factor = maxEdge / edge;
  return { width: Math.round(width * factor), height: Math.round(height * factor) };
}

/** Blob-IDs, auf die keine Aufgabe mehr verweist – auch kein Tombstone, der noch zurückkommen kann. */
export function orphanBlobIds(tasks: readonly Task[], blobIds: readonly string[]): string[] {
  const referenced = new Set(tasks.flatMap((task) => task.attachments.map((a) => a.id)));
  return blobIds.filter((id) => !referenced.has(id));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
