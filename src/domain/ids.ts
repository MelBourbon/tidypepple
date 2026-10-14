/**
 * UUIDv7: 48 bit Unix-Millis + Version/Variante + Zufall. Zeitlich sortierbar, damit
 * IndexedDB-Scans und Server-Inserts keine zufällig verteilten Schlüssel bekommen.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // Version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // Variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stabile Geräte-Kennung; wird beim ersten Start erzeugt und in `meta` abgelegt. */
export function newDeviceId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
