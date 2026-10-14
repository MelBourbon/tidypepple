import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { fileKeyVersion, openFile, sealFile } from '@/crypto/attachment';
import { createVault } from '@/crypto/keyring';
import { addAttachment, removeAttachment, restoreAttachment } from '@/data/attachments';
import { db, TidyDb } from '@/data/db';
import { createTask, deleteTask, initRepo, purgeLocalTombstones, resetRepo, resyncAll } from '@/data/repo';
import type { Attachment } from '@/domain/types';
import { BlobSync } from '@/sync/blobs';
import { SyncEngine } from '@/sync/engine';
import { MemoryBlobAdapter, MemorySyncAdapter } from '@/sync/memory';

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;
const VAULT_ID = 'vault-a';

let vaultKey: CryptoKey;
let files: MemoryBlobAdapter;
let blobs: BlobSync;

beforeEach(async () => {
  await resetRepo();
  await initRepo();
  ({ vaultKey } = await createVault('test-passphrase'));
  files = new MemoryBlobAdapter();
  blobs = new BlobSync(files, { key: () => vaultKey, keyVersion: () => 1, vaultId: () => VAULT_ID });
});

const attach = async (taskId: string, ...values: number[]): Promise<Attachment> => {
  expect(await addAttachment(taskId, { name: 'a.png', type: 'image/png', data: bytes(...values) })).toBeNull();
  return (await db.tasks.get(taskId))!.attachments.at(-1)!;
};

describe('Dateiverschlüsselung', () => {
  it('ver- und entschlüsselt, und die Schlüsselversion steht im Kopf', async () => {
    const sealed = await sealFile(vaultKey, 7, 'att-1', bytes(1, 2, 3));
    expect(fileKeyVersion(sealed)).toBe(7);
    expect(new Uint8Array(await openFile(vaultKey, 'att-1', sealed))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('lässt sich nicht einem anderen Anhang unterschieben', async () => {
    const sealed = await sealFile(vaultKey, 1, 'att-1', bytes(1, 2, 3));
    await expect(openFile(vaultKey, 'att-2', sealed)).rejects.toThrow();
  });

  it('der Server sieht nur Ciphertext', async () => {
    const sealed = await sealFile(vaultKey, 1, 'att-1', new TextEncoder().encode('Kontoauszug').buffer);
    expect(new TextDecoder().decode(sealed)).not.toContain('Kontoauszug');
  });
});

describe('Anhänge synchronisieren', () => {
  it('lädt neue Anhänge verschlüsselt hoch und leert die Warteschlange', async () => {
    const task = await createTask({ title: 'Mit Foto' });
    const a = await attach(task.id, 9, 8, 7);

    expect((await blobs.run()).uploaded).toBe(1);
    const sealed = files.files.get(`${task.id}/${a.id}`)!;
    expect(new Uint8Array(await openFile(vaultKey, a.id, sealed))).toEqual(new Uint8Array([9, 8, 7]));
    expect(await db.blobQueue.count()).toBe(0);
  });

  it('holt eine fehlende Datei auf Anfrage und legt sie lokal ab', async () => {
    const task = await createTask({ title: 'A' });
    const a = await attach(task.id, 1, 2);
    await blobs.run();
    await db.blobs.clear(); // wie ein zweites Gerät, das nur die Metadaten kennt

    expect(await blobs.fetch(task.id, a)).toBe('ok');
    expect(new Uint8Array((await db.blobs.get(a.id))!.data)).toEqual(new Uint8Array([1, 2]));
  });

  it('meldet eine noch nicht hochgeladene Datei als fehlend statt als Fehler', async () => {
    const task = await createTask({ title: 'A' });
    const a = await attach(task.id, 1);
    expect(await blobs.fetch(task.id, a)).toBe('missing');
  });

  it('ohne Abo bleibt alles in der Warteschlange und geht später raus', async () => {
    const task = await createTask({ title: 'A' });
    await attach(task.id, 1);
    files.status = 'entitlement';

    expect(await blobs.run()).toEqual({ uploaded: 0, removed: 0, blocked: 'entitlement' });
    expect(await db.blobQueue.count()).toBe(1);

    files.status = 'ok';
    expect((await blobs.run()).uploaded).toBe(1);
  });

  it('lädt nach einem Restore des Servers die Dateien erneut hoch, die auf dem Gerät liegen', async () => {
    const task = await createTask({ title: 'A' });
    const hier = await attach(task.id, 1);
    const anderswo = await attach(task.id, 2);
    await blobs.run();
    await db.blobs.delete(anderswo.id); // nur Metadaten, die Datei hat ein anderes Gerät
    files.files.clear(); // nach dem Restore fehlen die Dateien

    await resyncAll();

    expect(await db.blobQueue.toArray()).toEqual([{ id: hier.id, taskId: task.id, op: 'upload' }]);
    expect((await blobs.run()).uploaded).toBe(1);
    expect(files.files.has(`${task.id}/${hier.id}`)).toBe(true);
  });

  it('löscht entfernte Anhänge auf dem Server – aber nicht, wenn Undo sie zurückgeholt hat', async () => {
    const task = await createTask({ title: 'A' });
    const a = await attach(task.id, 1);
    const b = await attach(task.id, 2);
    await blobs.run();

    await removeAttachment(task.id, a.id);
    await removeAttachment(task.id, b.id);
    await restoreAttachment(task.id, b);

    expect((await blobs.run()).removed).toBe(1);
    expect(files.files.has(`${task.id}/${a.id}`)).toBe(false);
    expect(files.files.has(`${task.id}/${b.id}`)).toBe(true);
    expect(await db.blobQueue.count()).toBe(0);
  });

  it('lädt einen vor dem Upload entfernten Anhang gar nicht erst hoch', async () => {
    const task = await createTask({ title: 'A' });
    const a = await attach(task.id, 1);
    await removeAttachment(task.id, a.id);

    expect(await blobs.run()).toMatchObject({ uploaded: 0 });
    expect(files.files.size).toBe(0);
  });

  it('behält Dateien gelöschter Aufgaben bis zur Tombstone-Bereinigung', async () => {
    const task = await createTask({ title: 'A' });
    const a = await attach(task.id, 1);
    await blobs.run();
    await deleteTask(task.id);
    await db.outbox.clear(); // Löschung ist beim Server angekommen

    expect((await blobs.run()).removed).toBe(0);
    expect(files.files.has(`${task.id}/${a.id}`)).toBe(true);

    await db.tasks.update(task.id, { deletedAt: 1 });
    await purgeLocalTombstones(90 * 24 * 60 * 60 * 1000);
    expect((await blobs.run()).removed).toBe(1);
    expect(files.files.size).toBe(0);
  });

  it('läuft als Teil eines Sync-Durchlaufs, nach den Aufgaben', async () => {
    const task = await createTask({ title: 'A' });
    await attach(task.id, 1);
    const engine = new SyncEngine(new MemorySyncAdapter(), { key: () => vaultKey, keyVersion: () => 1, vaultId: () => VAULT_ID }, blobs);

    const result = await engine.syncOnce();
    expect(result).toMatchObject({ pushed: 1, filesUploaded: 1, filesBlocked: null });
  });
});

describe('Migration auf Version 4', () => {
  it('stellt Anhänge aus Stufe 1 zum Hochladen ein', async () => {
    const name = 'migration-v3';
    const v3 = new Dexie(name);
    v3.version(3).stores({
      tasks: 'id, status, parentId, dueDate, createdAt, *contexts',
      contexts: 'id, order',
      outbox: 'recordId, seq',
      meta: 'key',
      blobs: 'id',
    });
    await v3.table('tasks').put({
      id: 'alt',
      title: 'Mit Anhang',
      contexts: [],
      attachments: [{ id: 'att-alt', name: 'a.png', type: 'image/png', size: 1, addedAt: 0 }],
    });
    v3.close();

    const v4 = new TidyDb(name);
    expect(await v4.blobQueue.get('att-alt')).toEqual({ id: 'att-alt', taskId: 'alt', op: 'upload' });
    await v4.delete();
  });
});
