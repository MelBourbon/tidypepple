import { createVault, unlockWithPassphrase, unlockWithRecoveryKey, type Keyring } from './keyring';
import { db, getMeta, setMeta } from '@/data/db';

/**
 * Der entsperrte Schlüssel bleibt über einen Neustart erhalten: in IndexedDB
 * liegt dafür das `CryptoKey`-Objekt selbst, nicht seine Bytes. Er ist nicht exportierbar –
 * der Browser ver- und entschlüsselt damit, aber kein Skript kann ihn auslesen und
 * mitnehmen. Mehr als das braucht es nicht: die Aufgaben liegen auf dem Gerät ohnehin im
 * Klartext, die Verschlüsselung schützt die Daten vor dem Server.
 *
 * "Sperren" und Abmelden entfernen den gespeicherten Schlüssel; danach braucht es wieder
 * Passphrase oder Wiederherstellungsschlüssel.
 */

const KEYRING_KEY = 'keyring';
const UNLOCKED_KEY = 'unlockedVaultKey';

/** Der Schlüssel gehört zu genau einem Vault – ein anderer Schlüsselbund macht ihn wertlos. */
interface StoredKey {
  vaultId: string;
  key: CryptoKey;
}

const remember = (vaultId: string, key: CryptoKey): Promise<void> =>
  setMeta(UNLOCKED_KEY, { vaultId, key } satisfies StoredKey);

let vaultKey: CryptoKey | null = null;
let keyring: Keyring | null = null;

export const loadKeyring = (): Promise<Keyring | undefined> => getMeta<Keyring>(KEYRING_KEY);

export async function hasVault(): Promise<boolean> {
  return (await loadKeyring()) !== undefined;
}

/** Legt den Vault an. Der Wiederherstellungsschlüssel wird genau einmal zurückgegeben. */
export async function setupVault(passphrase: string): Promise<{ recoveryKey: string }> {
  if (await hasVault()) throw new Error('Es gibt bereits einen Vault auf diesem Gerät.');
  const created = await createVault(passphrase);
  await setMeta(KEYRING_KEY, created.keyring);
  keyring = created.keyring;
  vaultKey = created.vaultKey;
  await remember(created.keyring.vaultId, created.vaultKey);
  return { recoveryKey: created.recoveryKey };
}

async function requireKeyring(): Promise<Keyring> {
  const stored = await loadKeyring();
  if (stored === undefined) throw new Error('Auf diesem Gerät ist kein Vault eingerichtet.');
  return stored;
}

export async function unlock(passphrase: string): Promise<void> {
  const stored = await requireKeyring();
  vaultKey = await unlockWithPassphrase(stored, passphrase);
  keyring = stored;
  await remember(stored.vaultId, vaultKey);
}

export async function unlockWithRecovery(recoveryKey: string): Promise<void> {
  const stored = await requireKeyring();
  vaultKey = await unlockWithRecoveryKey(stored, recoveryKey);
  keyring = stored;
  await remember(stored.vaultId, vaultKey);
}

/**
 * Entsperrt mit dem gespeicherten Schlüssel, falls er zum aktuellen Schlüsselbund passt.
 * Liefert, ob der Vault danach entsperrt ist.
 */
export async function restore(): Promise<boolean> {
  const [stored, remembered] = await Promise.all([loadKeyring(), getMeta<StoredKey>(UNLOCKED_KEY)]);
  if (stored === undefined) return false;
  if (vaultKey !== null && keyring?.vaultId === stored.vaultId) return true;
  vaultKey = null;
  keyring = null;
  if (remembered === undefined) return false;
  // Hat der Server inzwischen einen anderen Vault geliefert, passt der Schlüssel nicht mehr.
  if (remembered.vaultId !== stored.vaultId) {
    await db.meta.delete(UNLOCKED_KEY);
    return false;
  }
  vaultKey = remembered.key;
  keyring = stored;
  return true;
}

export async function lock(): Promise<void> {
  vaultKey = null;
  keyring = null;
  await db.meta.delete(UNLOCKED_KEY);
}

export const isUnlocked = (): boolean => vaultKey !== null;

export function currentKey(): CryptoKey {
  if (vaultKey === null) throw new Error('Vault ist gesperrt.');
  return vaultKey;
}

export function currentKeyVersion(): number {
  if (keyring === null) throw new Error('Vault ist gesperrt.');
  return keyring.keyVersion;
}

/**
 * Setzt den Vault samt aller Daten zurück. Nur für den Fall, dass Passphrase *und*
 * Wiederherstellungsschlüssel verloren sind – dann sind die Daten ohnehin unlesbar.
 */
export async function destroyVault(): Promise<void> {
  await lock();
  await db.transaction('rw', [db.tasks, db.contexts, db.outbox, db.meta, db.blobs, db.blobQueue], async () => {
    await Promise.all([
      db.tasks.clear(),
      db.contexts.clear(),
      db.outbox.clear(),
      db.meta.clear(),
      db.blobs.clear(),
      db.blobQueue.clear(),
    ]);
  });
}
