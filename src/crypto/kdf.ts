import { fromBase64, randomBytes, toBase64 } from './bytes';

/**
 * Passphrase → Schlüssel. Argon2id statt PBKDF2, weil es auch Speicher kostet und damit
 * GPU-Angriffe teuer macht; die Parameter liegen beim Schlüsselbund, damit sie später
 * erhöht werden können, ohne alte Daten unlesbar zu machen.
 */

export interface KdfParams {
  algo: 'argon2id';
  salt: string;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** 64 MiB / 3 Durchgänge: spürbar, aber auf einem Mittelklasse-Handy unter einer Sekunde. */
export function newKdfParams(): KdfParams {
  return {
    algo: 'argon2id',
    salt: toBase64(randomBytes(16)),
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
  };
}

export async function deriveKey(secret: string, params: KdfParams): Promise<CryptoKey> {
  // Dynamischer Import: das WASM-Modul wiegt mehr als der halbe App-Kern und wird nur
  // gebraucht, wenn jemand tatsächlich einen Vault auf- oder zuschließt.
  const { argon2id } = await import('hash-wasm');
  const raw = await argon2id({
    password: secret,
    salt: fromBase64(params.salt),
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  // `extractable: false`: der abgeleitete Schlüssel kann den WebCrypto-Kontext nicht mehr
  // verlassen – auch nicht über einen Bug in unserem eigenen Code.
  return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
