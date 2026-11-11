import {
  changePassphrase as rewrap,
  createVault,
  openPreviousKeys,
  rotateKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type Keyring,
  type RotatedVault,
  type Unlocked,
} from './keyring';
import { db, getMeta, META_KEYS, setMeta } from '@/data/db';

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

/**
 * Der Schlüssel gehört zu genau einem Vault und einer Schlüsselversion – ein anderer
 * Schlüsselbund oder eine Rotation auf einem anderen Gerät macht ihn wertlos.
 */
interface StoredKey {
  vaultId: string;
  /** Fehlt bei Schlüsseln, die vor der Rotation gespeichert wurden: dann Version 1. */
  keyVersion?: number;
  key: CryptoKey;
}

let vaultKey: CryptoKey | null = null;
let keyring: Keyring | null = null;
/** Frühere Schlüssel nach Version, für Records und Dateien, die noch nicht umgeschlüsselt sind. */
let previousKeys = new Map<number, CryptoKey>();

/** Entsperrt merken: im Speicher, und als `CryptoKey` für den nächsten Start. */
async function activate(stored: Keyring, key: CryptoKey, persist: boolean): Promise<void> {
  // Ein kaputter Eintrag soll das Entsperren nicht verhindern; ohne ihn sind nur alte
  // Records unlesbar, und die zählt der Sync als solche.
  const previous = await openPreviousKeys(stored, key).catch(() => new Map<number, CryptoKey>());
  vaultKey = key;
  keyring = stored;
  previousKeys = previous;
  if (persist) await setMeta(UNLOCKED_KEY, { vaultId: stored.vaultId, keyVersion: stored.keyVersion, key } satisfies StoredKey);
}

export const loadKeyring = (): Promise<Keyring | undefined> => getMeta<Keyring>(KEYRING_KEY);

export async function hasVault(): Promise<boolean> {
  return (await loadKeyring()) !== undefined;
}

/**
 * Legt den Vault an. Der Wiederherstellungsschlüssel wird genau einmal zurückgegeben,
 * `proof` gehört zum Server (`register_key_check`).
 */
export async function setupVault(passphrase: string): Promise<{ recoveryKey: string; proof: string }> {
  if (await hasVault()) throw new Error('Es gibt bereits einen Vault auf diesem Gerät.');
  const created = await createVault(passphrase);
  await setMeta(KEYRING_KEY, created.keyring);
  await activate(created.keyring, created.vaultKey, true);
  return { recoveryKey: created.recoveryKey, proof: created.proof };
}

async function requireKeyring(): Promise<Keyring> {
  const stored = await loadKeyring();
  if (stored === undefined) throw new Error('Auf diesem Gerät ist kein Vault eingerichtet.');
  return stored;
}

/** Entsperrt mit der Passphrase. Liefert den Nachweis für den Server (`register_key_check`). */
export async function unlock(passphrase: string): Promise<string> {
  const stored = await requireKeyring();
  const unlocked: Unlocked = await unlockWithPassphrase(stored, passphrase);
  await activate(stored, unlocked.key, true);
  return unlocked.proof;
}

export async function unlockWithRecovery(recoveryKey: string): Promise<string> {
  const stored = await requireKeyring();
  const unlocked = await unlockWithRecoveryKey(stored, recoveryKey);
  await activate(stored, unlocked.key, true);
  return unlocked.proof;
}

/**
 * Entsperrt mit dem gespeicherten Schlüssel, falls er zum aktuellen Schlüsselbund passt.
 * Liefert, ob der Vault danach entsperrt ist.
 */
export async function restore(): Promise<boolean> {
  const [stored, remembered] = await Promise.all([loadKeyring(), getMeta<StoredKey>(UNLOCKED_KEY)]);
  if (stored === undefined) return false;
  if (vaultKey !== null && keyring?.vaultId === stored.vaultId && keyring.keyVersion === stored.keyVersion) return true;
  vaultKey = null;
  keyring = null;
  previousKeys = new Map();
  if (remembered === undefined) return false;
  // Hat der Server inzwischen einen anderen Vault geliefert, oder hat ein anderes Gerät den
  // Schlüssel erneuert, passt der gespeicherte nicht mehr.
  if (remembered.vaultId !== stored.vaultId || (remembered.keyVersion ?? 1) !== stored.keyVersion) {
    await db.meta.delete(UNLOCKED_KEY);
    return false;
  }
  await activate(stored, remembered.key, false);
  return true;
}

/**
 * Den Vault-Key erneuern (`rotateKeyring`). `upload` übergibt den neuen Schlüsselbund dem
 * Server (`rotate_vault_key`); erst danach gilt er auf dem Gerät – scheitert der Server,
 * bleibt alles beim Alten.
 *
 * Danach steht `reencryptPending` auf der neuen Version: Die Sync-Engine schlüsselt beim
 * nächsten Lauf alles um, was auf dem Server noch mit einem alten Schlüssel liegt, und macht
 * nach einem Abbruch beim nächsten Lauf weiter.
 *
 * Liefert den neuen Wiederherstellungsschlüssel.
 */
export async function rotate(passphrase: string, upload: (rotated: RotatedVault) => Promise<void>): Promise<string> {
  const stored = await requireKeyring();
  const rotated = await rotateKeyring(stored, passphrase).catch((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'OperationError') throw new WrongPassphraseError();
    throw cause;
  });
  await upload(rotated);
  await setMeta(KEYRING_KEY, rotated.keyring);
  await activate(rotated.keyring, rotated.vaultKey, true);
  await setMeta(META_KEYS.reencryptPending, rotated.keyring.keyVersion);
  return rotated.recoveryKey;
}

/** Die bisherige Passphrase stimmt nicht – GCM meldet das als `OperationError`. */
export class WrongPassphraseError extends Error {
  readonly name = 'WrongPassphraseError';
}

/**
 * Passphrase wechseln. Der Vault-Key wird nur neu verpackt; kein Record, kein anderes Gerät
 * muss neu entsperrt werden.
 *
 * Erst `upload` (der Server), dann das Gerät: Scheitert der Server, bleibt hier alles beim
 * Alten. Andersherum gälte auf diesem Gerät eine Passphrase, die kein anderes kennt.
 */
export async function changePassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  upload: (keyring: Keyring) => Promise<void>,
): Promise<void> {
  const stored = await requireKeyring();
  const next = await rewrap(stored, oldPassphrase, newPassphrase).catch((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'OperationError') throw new WrongPassphraseError();
    throw cause;
  });
  await upload(next);
  await setMeta(KEYRING_KEY, next);
  if (keyring?.vaultId === next.vaultId) keyring = next;
}

export async function lock(): Promise<void> {
  vaultKey = null;
  keyring = null;
  previousKeys = new Map();
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

/** Schlüssel für eine Version: der aktuelle oder ein früherer. `undefined`, wenn unbekannt. */
export function keyFor(version: number): CryptoKey | undefined {
  if (vaultKey === null || keyring === null) throw new Error('Vault ist gesperrt.');
  return version === keyring.keyVersion ? vaultKey : previousKeys.get(version);
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
