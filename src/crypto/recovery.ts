import { randomBytes } from './bytes';

/**
 * Wiederherstellungsschlüssel als Crockford-Base32: das Alphabet lässt I, L, O und U weg,
 * sodass sich 1/I/l und 0/O beim Abschreiben nicht verwechseln lassen.
 *
 * Bewusst kein BIP39-Wortlistenverfahren: eine 2048-Wörter-Liste wäre englisch (in einer
 * deutschen App fehl am Platz) und kostet Bundle-Größe. 120 Bit Zufall in sechs Vierergruppen
 * sind ebenso sicher und lassen sich genauso gut auf Papier schreiben.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 6;
const GROUP_LENGTH = 4;

export function generateRecoveryKey(): string {
  const bytes = randomBytes(15); // 120 Bit → genau 24 Base32-Zeichen
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
  }
  return (out.match(new RegExp(`.{1,${GROUP_LENGTH}}`, 'g')) ?? []).join('-');
}

/** Tippfehler-tolerant: Groß-/Kleinschreibung, Trennzeichen und die Klassiker I→1, O→0. */
export function normalizeRecoveryKey(input: string): string {
  const normalized = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
  if (normalized.length !== GROUPS * GROUP_LENGTH) {
    throw new Error(`Wiederherstellungsschlüssel muss ${GROUPS * GROUP_LENGTH} Zeichen haben.`);
  }
  if ([...normalized].some((c) => !ALPHABET.includes(c))) {
    throw new Error('Wiederherstellungsschlüssel enthält ungültige Zeichen.');
  }
  return normalized;
}
