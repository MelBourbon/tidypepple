import { openBytes, seal, sealBytes, type Envelope } from './envelope';
import { deriveKey, newKdfParams, type KdfParams } from './kdf';
import { normalizeRecoveryKey, generateRecoveryKey } from './recovery';
import { fromBase64, randomBytes, toBase64 } from './bytes';
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
}

const VAULT_KEY_LABEL = 'vault-key';
const IDENTITY_LABEL = 'identity-private-key';

const importVaultKey = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);

export interface NewVault {
  keyring: Keyring;
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

  return {
    keyring: {
      vaultId: uuidv7(),
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

async function unwrap(keyring: Keyring, secret: string, path: 'passphrase' | 'recovery'): Promise<CryptoKey> {
  const { kdf, wrapped } = keyring[path];
  const kek = await deriveKey(secret, kdf);
  // Schlägt die Entschlüsselung fehl, war die Passphrase falsch – GCM prüft das mit.
  const raw = await openBytes(kek, VAULT_KEY_LABEL, wrapped);
  return importVaultKey(raw);
}

export const unlockWithPassphrase = (keyring: Keyring, passphrase: string): Promise<CryptoKey> =>
  unwrap(keyring, passphrase, 'passphrase');

export const unlockWithRecoveryKey = (keyring: Keyring, recoveryKey: string): Promise<CryptoKey> =>
  unwrap(keyring, normalizeRecoveryKey(recoveryKey), 'recovery');

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
