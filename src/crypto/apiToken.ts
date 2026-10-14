import { openBytes, sealBytes, type Envelope } from './envelope';
import { fromBase64, randomBytes, toBase64, utf8 } from './bytes';
import { uuidv7 } from '@/domain/ids';

/**
 * API-Tokens für den MCP-Server (`supabase/migrations/0001_schema.sql`, Abschnitt 11).
 *
 *   tp1.<id>.<authSecret>.<keySecret>
 *
 * Zwei Geheimnisse, weil der Server das Token prüfen, den Vault-Key aber nicht öffnen können
 * soll: `authSecret` geht bei jeder Anfrage mit, der Server kennt davon nur den SHA-256-Hash.
 * `keySecret` verlässt den Rechner nie; mit ihm ist der Vault-Key verpackt.
 *
 * Beide sind 256 Bit zufällig. Ein langsamer KDF wie Argon2 schützt nur schwache Geheimnisse,
 * hier reicht HKDF.
 */

const PREFIX = 'tp1';
const SECRET_BYTES = 32;
const LABEL = 'api-token-vault-key';

export type ApiTokenScope = 'read' | 'write';

export interface ApiToken {
  id: string;
  authSecret: string;
  keySecret: string;
}

/** Base64url ohne Auffüllung – passt ohne Escaping in Umgebungsvariablen und JSON. */
const toBase64Url = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const formatApiToken = (token: ApiToken): string =>
  `${PREFIX}.${token.id}.${token.authSecret}.${token.keySecret}`;

export function generateApiToken(): ApiToken {
  return {
    id: uuidv7(),
    authSecret: toBase64Url(randomBytes(SECRET_BYTES)),
    keySecret: toBase64Url(randomBytes(SECRET_BYTES)),
  };
}

/** `null`, wenn es kein TidyPepple-Token ist – etwa beim Kopieren abgeschnitten. */
export function parseApiToken(text: string): ApiToken | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  const [prefix, id, authSecret, keySecret] = parts as [string, string, string, string];
  if (prefix !== PREFIX || !ID_PATTERN.test(id)) return null;
  if (!SECRET_PATTERN.test(authSecret) || !SECRET_PATTERN.test(keySecret)) return null;
  return { id, authSecret, keySecret };
}

/** Was der Server speichert: SHA-256 von `authSecret`, hex – wie `api_token_check` es rechnet. */
export async function authHash(authSecret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(authSecret)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Die Token-ID geht als Salt ein: dasselbe Geheimnis ergäbe für ein anderes Token einen anderen Schlüssel. */
async function deriveKek(token: ApiToken): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', fromBase64Url(token.keySecret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(token.id), info: utf8(LABEL) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapVaultKeyForToken(vaultKeyRaw: Uint8Array, token: ApiToken): Promise<Envelope> {
  return sealBytes(await deriveKek(token), LABEL, vaultKeyRaw);
}

/** Schlägt fehl, wenn `keySecret` nicht passt – GCM prüft das mit. */
export async function unwrapVaultKeyWithToken(wrapped: Envelope, token: ApiToken): Promise<CryptoKey> {
  const raw = await openBytes(await deriveKek(token), LABEL, wrapped);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
