import { beforeEach, describe, expect, it } from 'vitest';
import { addAttachment, purgeOrphanBlobs, removeAttachment, restoreAttachment } from '@/data/attachments';
import { db } from '@/data/db';
import { createTask, deleteTask, initRepo, resetRepo } from '@/data/repo';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_QUOTA_BYTES,
  checkAttachment,
  formatBytes,
  orphanBlobIds,
  scaledSize,
  usedBytes,
} from '@/domain/attachments';
import { task } from './factory';

const file = (size: number, type = 'image/jpeg') => ({ name: 'bild.jpg', type, data: new ArrayBuffer(size) });

describe('Regeln für Anhänge', () => {
  it('nimmt Bilder und PDFs bis 5 MB', () => {
    expect(checkAttachment({ type: 'image/png', size: 1000 }, 0)).toBeNull();
    expect(checkAttachment({ type: 'application/pdf', size: ATTACHMENT_MAX_BYTES }, 0)).toBeNull();
    expect(checkAttachment({ type: 'application/pdf', size: ATTACHMENT_MAX_BYTES + 1 }, 0)).toBe('size');
    expect(checkAttachment({ type: 'application/zip', size: 10 }, 0)).toBe('type');
  });

  it('hält das Kontingent von 200 MB ein', () => {
    expect(checkAttachment({ type: 'image/png', size: 2 }, ATTACHMENT_QUOTA_BYTES - 1)).toBe('quota');
    expect(checkAttachment({ type: 'image/png', size: 1 }, ATTACHMENT_QUOTA_BYTES - 1)).toBeNull();
  });

  it('zählt Anhänge gelöschter Aufgaben nicht mit', () => {
    const meta = (size: number) => ({ id: `a${size}`, name: 'x', type: 'image/png', size, addedAt: 0 });
    expect(usedBytes([task({ attachments: [meta(10)] }), task({ attachments: [meta(5)], deletedAt: 1 })])).toBe(10);
  });

  it('verkleinert nur, was größer ist als die Grenze, und hält das Seitenverhältnis', () => {
    expect(scaledSize(2000, 1000, 2560)).toBeNull();
    expect(scaledSize(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(scaledSize(3000, 6000, 2560)).toEqual({ width: 1280, height: 2560 });
  });

  it('findet Dateien ohne Verweis, schont aber die von Tombstones', () => {
    const meta = (id: string) => ({ id, name: 'x', type: 'image/png', size: 1, addedAt: 0 });
    const tasks = [task({ attachments: [meta('lebt')] }), task({ attachments: [meta('tombstone')], deletedAt: 1 })];
    expect(orphanBlobIds(tasks, ['lebt', 'tombstone', 'waise'])).toEqual(['waise']);
  });

  it('formatiert Größen deutsch', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});

describe('Anhänge speichern', () => {
  beforeEach(async () => {
    await resetRepo();
    await initRepo();
  });

  it('legt Datei und Metadaten an und markiert die Aufgabe für den Sync', async () => {
    const t = await createTask({ title: 'Mit Foto' });
    await db.outbox.clear();
    expect(await addAttachment(t.id, file(1000))).toBeNull();

    const [meta] = (await db.tasks.get(t.id))!.attachments;
    expect(meta).toMatchObject({ name: 'bild.jpg', type: 'image/jpeg', size: 1000 });
    expect((await db.blobs.get(meta!.id))?.data.byteLength).toBe(1000);
    expect(await db.outbox.get(t.id)).toBeDefined();
  });

  it('lehnt zu große Dateien ab, ohne etwas zu speichern', async () => {
    const t = await createTask({ title: 'A' });
    expect(await addAttachment(t.id, file(ATTACHMENT_MAX_BYTES + 1, 'application/pdf'))).toBe('size');
    expect(await db.blobs.count()).toBe(0);
    expect((await db.tasks.get(t.id))!.attachments).toEqual([]);
  });

  it('Entfernen lässt sich rückgängig machen; die Datei verschwindet erst beim Aufräumen', async () => {
    const t = await createTask({ title: 'A' });
    await addAttachment(t.id, file(10));
    const [meta] = (await db.tasks.get(t.id))!.attachments;

    await removeAttachment(t.id, meta!.id);
    expect((await db.tasks.get(t.id))!.attachments).toEqual([]);
    expect(await db.blobs.count()).toBe(1);

    await restoreAttachment(t.id, meta!);
    expect(await purgeOrphanBlobs()).toBe(0);

    await removeAttachment(t.id, meta!.id);
    expect(await purgeOrphanBlobs()).toBe(1);
    expect(await db.blobs.count()).toBe(0);
  });

  it('behält die Dateien gelöschter Aufgaben, solange Undo sie zurückholen kann', async () => {
    const t = await createTask({ title: 'A' });
    await addAttachment(t.id, file(10));
    await deleteTask(t.id);
    expect(await purgeOrphanBlobs()).toBe(0);
  });
});
