import { beforeEach, describe, expect, it } from 'vitest';
import { db, getMeta, META_KEYS, setMeta } from '@/data/db';
import { createTask, initRepo, resetRepo, updateTask } from '@/data/repo';
import { addAttachment } from '@/data/attachments';
import { open } from '@/crypto/envelope';
import { fileKeyVersion } from '@/crypto/attachment';
import {
  createVault,
  openPreviousKeys,
  rotateKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type Keyring,
} from '@/crypto/keyring';
import { MemoryBlobAdapter, MemorySyncAdapter } from '@/sync/memory';
import { SyncEngine, type VaultAccess } from '@/sync/engine';
import { BlobSync } from '@/sync/blobs';

/**
 * Rotation des Vault-Keys: neuer Schlüssel, alles auf dem Server umgeschlüsselt, ein Gerät
 * mit dem alten Schlüssel hält an, statt Daten zu verlieren oder alt weiterzuschreiben.
 */

const VAULT_ID = 'vault-a';

let adapter: MemorySyncAdapter;
let files: MemoryBlobAdapter;
let keyring: Keyring;

/** Was ein Gerät vom Vault weiß – wie `crypto/vault.ts`, nur ohne Modulzustand. */
function access(key: CryptoKey, keyVersion: number, previous = new Map<number, CryptoKey>()): VaultAccess {
  return { key: () => key, keyVersion: () => keyVersion, vaultId: () => VAULT_ID, keyFor: (v) => previous.get(v) };
}

const engineFor = (vault: VaultAccess): SyncEngine => new SyncEngine(adapter, vault, new BlobSync(files, vault));

beforeEach(async () => {
  await resetRepo();
  await initRepo();
  adapter = new MemorySyncAdapter();
  files = new MemoryBlobAdapter();
  keyring = (await createVault('alte-passphrase')).keyring;
});

describe('Rotation', () => {
  it('schlüsselt Records und Anhänge um, ohne Stand oder Cursor zu ändern', async () => {
    const { key: v1 } = await unlockWithPassphrase(keyring, 'alte-passphrase');
    const task = await createTask({ title: 'Geheim', status: 'next' });
    await addAttachment(task.id, { name: 'a.pdf', type: 'application/pdf', data: new Uint8Array([1, 2, 3]).buffer });
    await engineFor(access(v1, 1)).syncOnce();
    const before = new Map(adapter.all().map((r) => [r.id, r]));

    const rotated = await rotateKeyring(keyring, 'alte-passphrase');
    adapter.keyVersion = 2;
    await setMeta(META_KEYS.reencryptPending, 2);
    const v2 = access(rotated.vaultKey, 2, await openPreviousKeys(rotated.keyring, rotated.vaultKey));
    const result = await engineFor(v2).syncOnce();

    expect(result.reencrypted).toBe(before.size + 1);
    expect(await getMeta(META_KEYS.reencryptPending)).toBeUndefined();
    for (const record of adapter.all()) {
      expect(record.keyVersion).toBe(2);
      // Kein Gerät muss neu holen, und offline gemachte Änderungen verlieren nicht gegen die Rotation.
      expect(record.hlc).toBe(before.get(record.id)!.hlc);
      expect(record.serverSeq).toBe(before.get(record.id)!.serverSeq);
    }
    const stored = adapter.all().find((r) => r.id === task.id)!;
    expect(await open(rotated.vaultKey, task.id, stored)).toMatchObject({ value: { title: 'Geheim' } });
    // Mit dem alten Schlüssel ist auf dem Server nichts mehr zu lesen.
    await expect(open(v1, task.id, stored)).rejects.toThrow();
    for (const file of files.files.values()) expect(fileKeyVersion(file)).toBe(2);
  });

  it('gibt einen neuen Wiederherstellungsschlüssel; die Passphrase bleibt', async () => {
    const original = await createVault('alte-passphrase');
    const rotated = await rotateKeyring(original.keyring, 'alte-passphrase');

    expect(rotated.recoveryKey).not.toBe(original.recoveryKey);
    await expect(unlockWithRecoveryKey(rotated.keyring, original.recoveryKey)).rejects.toThrow();
    const viaRecovery = await unlockWithRecoveryKey(rotated.keyring, rotated.recoveryKey);
    const viaPassphrase = await unlockWithPassphrase(rotated.keyring, 'alte-passphrase');
    expect(viaRecovery.proof).toBe(rotated.newProof);
    expect(viaPassphrase.proof).toBe(rotated.newProof);
    // Der Nachweis für den alten Schlüssel ist der, den der Server bisher kannte.
    expect(rotated.oldProof).toBe((await unlockWithPassphrase(original.keyring, 'alte-passphrase')).proof);
    expect(rotated.keyring).toMatchObject({ keyVersion: 2, vaultId: original.keyring.vaultId, identityPublicKey: original.keyring.identityPublicKey });

    // Zweimal rotiert: beide alten Schlüssel bleiben über den neuesten erreichbar.
    const again = await rotateKeyring(rotated.keyring, 'alte-passphrase');
    expect([...(await openPreviousKeys(again.keyring, again.vaultKey)).keys()].sort()).toEqual([1, 2]);
  });

  it('hält ein Gerät mit altem Schlüssel an, ohne den Cursor weiterzuschieben oder die Outbox zu leeren', async () => {
    const { key: v1 } = await unlockWithPassphrase(keyring, 'alte-passphrase');
    const old = engineFor(access(v1, 1));
    await createTask({ title: 'Vor der Rotation', status: 'next' });
    await old.syncOnce();
    const cursor = await getMeta<number>(META_KEYS.pullCursor);

    // Ein anderes Gerät rotiert und schreibt danach mit dem neuen Schlüssel.
    const rotated = await rotateKeyring(keyring, 'alte-passphrase');
    adapter.keyVersion = 2;
    const other = access(rotated.vaultKey, 2, await openPreviousKeys(rotated.keyring, rotated.vaultKey));
    const fromOther = await createTask({ title: 'Nach der Rotation', status: 'next' });
    await engineFor(other).syncOnce();
    await db.meta.put({ key: META_KEYS.pullCursor, value: cursor });

    // Dieses Gerät bearbeitet offline weiter und kennt nur den alten Schlüssel.
    await updateTask(fromOther.id, { title: 'Hier geändert' });
    await expect(old.syncOnce()).rejects.toMatchObject({ name: 'KeyOutdatedError' });
    expect(await db.outbox.count()).toBe(1);
    expect(await getMeta<number>(META_KEYS.pullCursor)).toBe(cursor);

    // Nach dem Entsperren mit dem neuen Schlüsselbund geht die Änderung hinaus.
    expect((await old.syncOnce().catch((e: unknown) => e)) instanceof Error).toBe(true);
    await engineFor(other).syncOnce();
    expect(await db.outbox.count()).toBe(0);
    const stored = adapter.all().find((r) => r.id === fromOther.id)!;
    expect(await open(rotated.vaultKey, fromOther.id, stored)).toMatchObject({ value: { title: 'Hier geändert' } });
  });
});
