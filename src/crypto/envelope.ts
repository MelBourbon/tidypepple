import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from './bytes';

/**
 * AES-256-GCM mit frischem IV pro Schreibvorgang. Die Record-ID und die Schlüsselversion
 * gehen als "additional authenticated data" ein: der Server kann Ciphertext dadurch nicht
 * zwischen Records vertauschen, ohne dass die Entschlüsselung fehlschlägt.
 */

export interface Envelope {
  iv: string;
  ct: string;
  keyVersion: number;
}

const aadFor = (recordId: string, keyVersion: number): Uint8Array<ArrayBuffer> => utf8(`${recordId}|${keyVersion}`);

export async function seal(
  key: CryptoKey,
  recordId: string,
  keyVersion: number,
  value: unknown,
): Promise<Envelope> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(recordId, keyVersion) },
    key,
    utf8(JSON.stringify(value)),
  );
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)), keyVersion };
}

export async function open<T>(key: CryptoKey, recordId: string, envelope: Envelope): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: aadFor(recordId, envelope.keyVersion),
    },
    key,
    fromBase64(envelope.ct),
  );
  return JSON.parse(fromUtf8(new Uint8Array(plain))) as T;
}

/** Rohbytes (Schlüsselmaterial) statt JSON verpacken. */
export async function sealBytes(key: CryptoKey, label: string, bytes: Uint8Array): Promise<Envelope> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(label) },
    key,
    bytes as Uint8Array<ArrayBuffer>,
  );
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)), keyVersion: 0 };
}

export async function openBytes(key: CryptoKey, label: string, envelope: Envelope): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: utf8(label) },
    key,
    fromBase64(envelope.ct),
  );
  return new Uint8Array(plain);
}
