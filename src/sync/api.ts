import type { PullPage, RemoteRecord, SyncAdapter } from './adapter';
import {
  API_TOKEN_INVALID_CODE,
  API_TOKEN_READ_ONLY_CODE,
  ApiTokenInvalidError,
  ENTITLEMENT_REQUIRED_CODE,
  EntitlementRequiredError,
  VAULT_FORBIDDEN_CODE,
  VaultForbiddenError,
} from './errors';
import type { ApiToken, ApiTokenScope } from '@/crypto/apiToken';
import type { Envelope } from '@/crypto/envelope';

/**
 * Sync über ein API-Token statt über ein Supabase-Login. Für den MCP-Server, der
 * ohne Browser läuft: die Funktionen `api_*` aus `0001_schema.sql` (Abschnitt 11), direkt über PostgREST.
 * Das Token ist der Ausweis; mitgeschickt werden nur ID und `authSecret`, nie `keySecret`.
 *
 * Ohne Supabase-Bibliothek, nur `fetch` – der MCP-Server soll klein bleiben.
 */

export interface ApiConfig {
  /** `https://<projekt>.supabase.co` */
  url: string;
  /** Der öffentliche Anon-Key – derselbe, der in der App steckt. */
  anonKey: string;
}

export interface ApiSession {
  vaultId: string;
  keyVersion: number;
  scope: ApiTokenScope;
  name: string;
  wrappedVaultKey: Envelope;
}

interface RecordRow {
  id: string;
  hlc: string;
  iv: string;
  ct: string;
  key_version: number;
  deleted: boolean;
  server_seq: number;
}

interface PostgrestError {
  code?: string;
  message?: string;
}

export class ApiClient {
  constructor(
    private readonly config: ApiConfig,
    private readonly token: ApiToken,
  ) {}

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.config.url.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.config.anonKey,
        Authorization: `Bearer ${this.config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token_id: this.token.id, p_secret: this.token.authSecret, ...args }),
    });
    if (response.ok) return (await response.json()) as T;

    const error = (await response.json().catch(() => ({}))) as PostgrestError;
    const message = error.message ?? `HTTP ${response.status}`;
    switch (error.code) {
      case API_TOKEN_INVALID_CODE:
        throw new ApiTokenInvalidError(message);
      // Für die `SyncEngine` dasselbe wie ein fehlendes Abo: Hochladen gesperrt, Holen geht
      // weiter, die Outbox bleibt. Ein Lese-Token schreibt ohnehin nichts – bis auf das
      // Zusammenführen doppelter Kontexte, und das soll den Sync nicht abbrechen.
      case API_TOKEN_READ_ONLY_CODE:
      case ENTITLEMENT_REQUIRED_CODE:
        throw new EntitlementRequiredError(message);
      case VAULT_FORBIDDEN_CODE:
        throw new VaultForbiddenError(message);
      default:
        throw new Error(`${name} fehlgeschlagen: ${message}`);
    }
  }

  session(): Promise<ApiSession> {
    return this.rpc<ApiSession>('api_session', {});
  }

  adapter(): SyncAdapter {
    return {
      push: async (records: readonly RemoteRecord[]): Promise<void> => {
        if (records.length === 0) return;
        await this.rpc('api_push', {
          p_records: records.map(({ id, hlc, iv, ct, keyVersion, deleted }) => ({ id, hlc, iv, ct, keyVersion, deleted })),
        });
      },
      pull: async (cursor: number, limit: number): Promise<PullPage> => {
        const rows = await this.rpc<RecordRow[]>('api_pull', { p_cursor: cursor, p_limit: limit });
        return {
          records: rows.map((row) => ({
            id: row.id,
            hlc: row.hlc,
            iv: row.iv,
            ct: row.ct,
            keyVersion: row.key_version,
            deleted: row.deleted,
            serverSeq: row.server_seq,
          })),
          cursor: rows.at(-1)?.server_seq ?? cursor,
          hasMore: rows.length === limit,
        };
      },
      epoch: () => this.rpc<string>('api_epoch', {}),
    };
  }
}
