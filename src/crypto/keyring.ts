import { openBytes, seal, sealBytes, type Envelope } from './envelope';
import { deriveKey, newKdfParams, type KdfParams } from './kdf';
import { normalizeRecoveryKey, generateRecoveryKey } from './recovery';
import { fromBase64, randomBytes, toBase64, utf8 } from './bytes';
import { uuidv7 } from '@/domain/ids';

/**
 * Schlüsselhierarchie (Envelope Encryption):
 *
 *   Passphrase ──Argon2id──▶ KEK ─────┐
 *                                     ├─▶ Vault-Key (AES-256-GCM) ──▶ jeder Record
 *   Recovery-Key ─Argon2id──▶ KEK ────┘
 *
 * Der Vault-Key selbst wird nie aus einer Passphrase abgeleitet, sondern nur *mit* ihr
 * verpackt. Deshalb kann die Passphrase gewechselt werden, ohne einen einzigen Record
 * neu zu verschlüsseln – und ein zweiter Zugangsweg (Recovery-Key) existiert, ohne dass
 * der Server je Klartext sieht.
 *
 * Das Identity-Keypair wird heute noch nicht gebraucht. Es liegt trotzdem im Schlüsselbund,
 * damit geteilte Vaults später möglich sind, ohne bestehende Daten anzufassen: dann wird
 * der Vault-Key zusätzlich für den öffentlichen Schlüssel eines Mitglieds verpackt.
 */

export interface Keyring {
  vaultId: string;
  keyVersion: number;
  passphrase: { kdf: KdfParams; wrapped: Envelope };
  recovery: { kdf: KdfParams; wrapped: Envelope };
  identityPublicKey: string;
  identityPrivateKey: Envelope;
  /**
   * Frühere Vault-Keys nach einer Rotation, verpackt mit dem aktuellen. Damit bleibt lesbar,
   * was noch nicht umgeschlüsselt ist – etwa wenn die Rotation mittendrin abbrach. Wer den
   * aktuellen Schlüssel hat, bekommt so auch die alten; umgekehrt nicht.
   */
  previousKeys?: PreviousKey[];
}

export interface PreviousKey {
  keyVersion: number;
  wrapped: Envelope;
}

const VAULT_KEY_LABEL = 'vault-key';
const IDENTITY_LABEL = 'identity-private-key';
const previousLabel = (keyVersion: number): string => `vault-key-v${keyVersion}`;

const importVaultKey = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);

export interface NewVault {
  keyring: Keyring;
  /** Nachweis für den Server (`keyProof`). */
  proof: string;
  /** Nur hier und nur einmal im Klartext – der Nutzer muss ihn jetzt sichern. */
  recoveryKey: string;
  vaultKey: CryptoKey;
}

export async function createVault(passphrase: string): Promise<NewVault> {
  const vaultKeyRaw = randomBytes(32);
  const recoveryKey = generateRecoveryKey();

  const passphraseKdf = newKdfParams();
  const recoveryKdf = newKdfParams();
  const [passphraseKek, recoveryKek] = await Promise.all([
    deriveKey(passphrase, passphraseKdf),
    deriveKey(normalizeRecoveryKey(recoveryKey), recoveryKdf),
  ]);

  const [wrappedByPassphrase, wrappedByRecovery] = await Promise.all([
    sealBytes(passphraseKek, VAULT_KEY_LABEL, vaultKeyRaw),
    sealBytes(recoveryKek, VAULT_KEY_LABEL, vaultKeyRaw),
  ]);

  const vaultKey = await importVaultKey(vaultKeyRaw);
  const identity = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', identity.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', identity.privateKey));

  const vaultId = uuidv7();
  return {
    proof: await keyProof(vaultKeyRaw, vaultId, 1),
    keyring: {
      vaultId,
      keyVersion: 1,
      passphrase: { kdf: passphraseKdf, wrapped: wrappedByPassphrase },
      recovery: { kdf: recoveryKdf, wrapped: wrappedByRecovery },
      identityPublicKey: toBase64(publicKey),
      identityPrivateKey: await sealBytes(vaultKey, IDENTITY_LABEL, privateKey),
    },
    recoveryKey,
    vaultKey,
  };
}

export interface Unlocked {
  key: CryptoKey;
  /** Nachweis, dass dieses Gerät den Schlüssel hat (`keyProof`) – für den Server. */
  proof: string;
}

async function unwrapRaw(keyring: Keyring, secret: string, path: 'passphrase' | 'recovery'): Promise<Uint8Array<ArrayBuffer>> {
  const { kdf, wrapped } = keyring[path];
  const kek = await deriveKey(secret, kdf);
  // Schlägt die Entschlüsselung fehl, war die Passphrase falsch – GCM prüft das mit.
  return openBytes(kek, VAULT_KEY_LABEL, wrapped);
}

async function unwrap(keyring: Keyring, secret: string, path: 'passphrase' | 'recovery'): Promise<Unlocked> {
  const raw = await unwrapRaw(keyring, secret, path);
  return { key: await importVaultKey(raw), proof: await keyProof(raw, keyring.vaultId, keyring.keyVersion) };
}

export const unlockWithPassphrase = (keyring: Keyring, passphrase: string): Promise<Unlocked> =>
  unwrap(keyring, passphrase, 'passphrase');

export const unlockWithRecoveryKey = (keyring: Keyring, recoveryKey: string): Promise<Unlocked> =>
  unwrap(keyring, normalizeRecoveryKey(recoveryKey), 'recovery');

/**
 * Nachweis für den Server, dass jemand den Vault-Key hat – ohne ihn zu verraten. HKDF ist
 * eine Einbahnstraße: Aus dem Nachweis lässt sich der Schlüssel nicht zurückrechnen. Vault
 * und Version gehen ein, damit derselbe Schlüssel nie zweimal denselben Nachweis ergibt.
 * Der Server speichert davon nur den Hash (`key_check`, 0007_key_rotation.sql).
 */
export async function keyProof(raw: Uint8Array, vaultId: string, keyVersion: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(vaultId), info: utf8(`tidypepple-key-check|v${keyVersion}`) },
    material,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Die früheren Schlüssel nach Version, geöffnet mit dem aktuellen. */
export async function openPreviousKeys(keyring: Keyring, vaultKey: CryptoKey): Promise<Map<number, CryptoKey>> {
  const keys = new Map<number, CryptoKey>();
  for (const previous of keyring.previousKeys ?? []) {
    const raw = await openBytes(vaultKey, previousLabel(previous.keyVersion), previous.wrapped);
    keys.set(previous.keyVersion, await importVaultKey(raw));
  }
  return keys;
}

export interface RotatedVault {
  keyring: Keyring;
  vaultKey: CryptoKey;
  /** Der neue Wiederherstellungsschlüssel – nur hier und nur einmal im Klartext. */
  recoveryKey: string;
  /** Nachweis für den bisherigen Schlüssel, den der Server prüft. */
  oldProof: string;
  /** Nachweis für den neuen, den der Server sich merkt. */
  newProof: string;
}

/**
 * Neuer Vault-Key. Braucht die Passphrase, weil der gespeicherte Schlüssel nicht exportierbar
 * ist und der neue mit ihr verpackt wird.
 *
 * Auch der Wiederherstellungsschlüssel ist neu: Der alte verpackt nur den alten Vault-Key,
 * und den neuen mit ihm zu verpacken hieße, ihn hier zu verlangen. Ein neuer ist ohnehin
 * richtig – wer den alten Vault-Key kannte, kannte vielleicht auch ihn.
 *
 * Die Identität (Schlüsselpaar für spätere geteilte Vaults) bleibt; nur ihr privater Teil
 * wird mit dem neuen Schlüssel neu verpackt.
 */
export async function rotateKeyring(keyring: Keyring, passphrase: string): Promise<RotatedVault> {
  const oldRaw = await unwrapRaw(keyring, passphrase, 'passphrase');
  const oldKey = await importVaultKey(oldRaw);
  const keyVersion = keyring.keyVersion + 1;
  const raw = randomBytes(32);
  const vaultKey = await importVaultKey(raw);
  const recoveryKey = generateRecoveryKey();

  const passphraseKdf = newKdfParams();
  const recoveryKdf = newKdfParams();
  const [passphraseKek, recoveryKek] = await Promise.all([
    deriveKey(passphrase, passphraseKdf),
    deriveKey(normalizeRecoveryKey(recoveryKey), recoveryKdf),
  ]);

  const previousKeys: PreviousKey[] = [];
  for (const old of keyring.previousKeys ?? []) {
    const bytes = await openBytes(oldKey, previousLabel(old.keyVersion), old.wrapped);
    previousKeys.push({ keyVersion: old.keyVersion, wrapped: await sealBytes(vaultKey, previousLabel(old.keyVersion), bytes) });
  }
  previousKeys.push({
    keyVersion: keyring.keyVersion,
    wrapped: await sealBytes(vaultKey, previousLabel(keyring.keyVersion), oldRaw),
  });

  const identity = await openBytes(oldKey, IDENTITY_LABEL, keyring.identityPrivateKey);

  return {
    keyring: {
      vaultId: keyring.vaultId,
      keyVersion,
      passphrase: { kdf: passphraseKdf, wrapped: await sealBytes(passphraseKek, VAULT_KEY_LABEL, raw) },
      recovery: { kdf: recoveryKdf, wrapped: await sealBytes(recoveryKek, VAULT_KEY_LABEL, raw) },
      identityPublicKey: keyring.identityPublicKey,
      identityPrivateKey: await sealBytes(vaultKey, IDENTITY_LABEL, identity),
      previousKeys,
    },
    vaultKey,
    recoveryKey,
    oldProof: await keyProof(oldRaw, keyring.vaultId, keyring.keyVersion),
    newProof: await keyProof(raw, keyring.vaultId, keyVersion),
  };
}

/**
 * Passphrase wechseln: der Vault-Key wird neu verpackt, nicht neu erzeugt. Kein einziger
 * Record muss dafür angefasst werden.
 */
export async function changePassphrase(keyring: Keyring, oldPassphrase: string, newPassphrase: string): Promise<Keyring> {
  const oldKek = await deriveKey(oldPassphrase, keyring.passphrase.kdf);
  const raw = await openBytes(oldKek, VAULT_KEY_LABEL, keyring.passphrase.wrapped);

  const kdf = newKdfParams();
  const wrapped = await sealBytes(await deriveKey(newPassphrase, kdf), VAULT_KEY_LABEL, raw);
  return { ...keyring, passphrase: { kdf, wrapped } };
}

/**
 * Die Rohbytes des Vault-Keys, um sie für einen weiteren Zugang zu verpacken (API-Token).
 * Der gespeicherte `CryptoKey` ist nicht exportierbar, deshalb geht das nur mit der Passphrase.
 */
export async function exportVaultKeyRaw(keyring: Keyring, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await deriveKey(passphrase, keyring.passphrase.kdf);
  return openBytes(kek, VAULT_KEY_LABEL, keyring.passphrase.wrapped);
}

/** Den privaten Identity-Schlüssel auspacken (für späteres Teilen von Vaults). */
export async function openIdentityPrivateKey(keyring: Keyring, vaultKey: CryptoKey): Promise<CryptoKey> {
  const pkcs8 = await openBytes(vaultKey, IDENTITY_LABEL, keyring.identityPrivateKey);
  return crypto.subtle.importKey('pkcs8', pkcs8 as Uint8Array<ArrayBuffer>, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
}

export const importIdentityPublicKey = (keyring: Keyring): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'spki',
    fromBase64(keyring.identityPublicKey) as Uint8Array<ArrayBuffer>,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );

/** Hilfsfunktion für den Sync: einen Record mit dem aktuellen Vault-Key verpacken. */
export const sealRecord = (vaultKey: CryptoKey, keyring: Keyring, recordId: string, value: unknown): Promise<Envelope> =>
  seal(vaultKey, recordId, keyring.keyVersion, value);
