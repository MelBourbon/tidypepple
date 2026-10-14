/** Base64 ohne Node- oder Browser-Spezifika – dieselbe Funktion läuft in Tests und im Browser. */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += CHARS[a >> 2];
    out += CHARS[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : CHARS[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : CHARS[c & 63];
  }
  return out;
}

/**
 * Rückgabetyp bewusst `Uint8Array<ArrayBuffer>`: WebCrypto akzeptiert als `BufferSource`
 * keine Sicht auf einen `SharedArrayBuffer`, und der breitere Standardtyp schließt den ein.
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0;
  let acc = 0;
  let out = 0;
  for (const char of clean) {
    const value = CHARS.indexOf(char);
    if (value === -1) throw new Error('Ungültiges Base64.');
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (acc >> bits) & 0xff;
    }
  }
  return bytes;
}

export const utf8 = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
export const fromUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
