import type { SupabaseClient } from '@supabase/supabase-js';
import {
  authHash,
  formatApiToken,
  generateApiToken,
  wrapVaultKeyForToken,
  type ApiTokenScope,
} from '@/crypto/apiToken';
import { exportVaultKeyRaw, type Keyring } from '@/crypto/keyring';

/**
 * API-Tokens verwalten (`0001_schema.sql`, Abschnitt 11). Ein Token entsteht hier, auf dem
 * Gerät: Nur hier gibt es den Vault-Key, und nur hier darf `keySecret` je existieren.
 */

export interface ApiTokenInfo {
  id: string;
  name: string;
  scope: ApiTokenScope;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface TokenRow {
  id: string;
  name: string;
  scope: ApiTokenScope;
  created_at: string;
  last_used_at: string | null;
}

export async function listApiTokens(client: SupabaseClient): Promise<ApiTokenInfo[]> {
  const { data, error } = await client
    .from('api_tokens')
    .select('id, name, scope, created_at, last_used_at')
    .order('created_at', { ascending: true });
  if (error !== null) throw new Error(`API-Tokens nicht abrufbar: ${error.message}`);
  return ((data ?? []) as TokenRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : new Date(row.last_used_at),
  }));
}

/**
 * Legt ein Token an und liefert es als Text – genau einmal, danach kennt es niemand mehr.
 * Die Passphrase ist nötig, weil der gespeicherte Vault-Key nicht exportierbar ist.
 */
export async function createApiToken(
  client: SupabaseClient,
  keyring: Keyring,
  passphrase: string,
  name: string,
  scope: ApiTokenScope,
): Promise<string> {
  const raw = await exportVaultKeyRaw(keyring, passphrase);
  const token = generateApiToken();
  const [hash, wrapped] = await Promise.all([authHash(token.authSecret), wrapVaultKeyForToken(raw, token)]);
  raw.fill(0);

  const { error } = await client.rpc('create_api_token', {
    p_id: token.id,
    p_vault_id: keyring.vaultId,
    p_name: name,
    p_scope: scope,
    p_auth_hash: hash,
    p_wrapped_vault_key: wrapped,
  });
  if (error !== null) throw new Error(error.message);
  return formatApiToken(token);
}

export async function revokeApiToken(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc('revoke_api_token', { p_id: id });
  if (error !== null) throw new Error(`Widerrufen fehlgeschlagen: ${error.message}`);
}
