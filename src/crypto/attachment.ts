import { randomBytes, utf8 } from './bytes';

/**
 * Dateiformat verschlüsselter Anhänge. Binär statt JSON/Base64 wie bei den
 * Records – bei Dateien bis 5 MB wären 33 % Aufschlag spürbar.
 *
 *   [1 Byte Formatversion][4 Byte Schlüsselversion, big-endian][12 Byte IV][Ciphertext + Tag]
 *
 * Anhang-ID und Schlüsselversion gehen als AAD ein: der Server kann Dateien nicht zwischen
 * Anhängen vertauschen, ohne dass das Entschlüsseln fehlschlägt.
 */

const FORMAT = 1;
const HEADER = 1 + 4 + 12;

const aadFor = (attachmentId: string, keyVersion: number): Uint8Array<ArrayBuffer> =>
  utf8(`attachment|${attachmentId}|${keyVersion}`);

export async function sealFile(
  key: CryptoKey,
  keyVersion: number,
  attachmentId: string,
  plain: ArrayBuffer,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(attachmentId, keyVersion) }, key, plain),
  );
  const out = new Uint8Array(HEADER + ct.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, FORMAT);
  view.setUint32(1, keyVersion);
  out.set(iv, 5);
  out.set(ct, HEADER);
  return out;
}

/** Schlüsselversion einer verschlüsselten Datei – um den passenden Schlüssel zu wählen. */
export function fileKeyVersion(sealed: Uint8Array): number {
  if (sealed.length < HEADER || sealed[0] !== FORMAT) throw new Error('Unbekanntes Dateiformat.');
  return new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength).getUint32(1);
}

export async function openFile(key: CryptoKey, attachmentId: string, sealed: Uint8Array): Promise<ArrayBuffer> {
  const keyVersion = fileKeyVersion(sealed);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.slice(5, HEADER), additionalData: aadFor(attachmentId, keyVersion) },
    key,
    sealed.slice(HEADER),
  );
}
