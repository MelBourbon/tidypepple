import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlobAdapter, BlobUploadStatus, PullPage, ReencryptedRecord, RemoteRecord, SyncAdapter } from './adapter';
import type { Keyring, RotatedVault } from '@/crypto/keyring';
import {
  ENTITLEMENT_REQUIRED_CODE,
  EntitlementRequiredError,
  KEY_OUTDATED_CODE,
  KeyOutdatedError,
  RECORD_QUOTA_CODE,
  RecordQuotaError,
  VAULT_FORBIDDEN_CODE,
  VaultForbiddenError,
} from './errors';

/**
 * Supabase als Ablage für verschlüsselte Blobs. Die Zugriffskontrolle macht Row Level
 * Security über `vault_members`; der Anon-Key ist öffentlich und schützt nichts.
 */

interface RecordRow {
  id: string;
  hlc: string;
  iv: string;
  ct: string;
  key_version: number;
  deleted: boolean;
  server_seq: number;
}

/** PostgREST: „Could not find the function … in the schema cache“. */
const FUNCTION_MISSING_CODE = 'PGRST202';

const toRemote = (row: RecordRow): RemoteRecord => ({
  id: row.id,
  hlc: row.hlc,
  iv: row.iv,
  ct: row.ct,
  keyVersion: row.key_version,
  deleted: row.deleted,
  serverSeq: row.server_seq,
});

const configOf = (): { url: string; key: string } | null => {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const key = import.meta.env['VITE_SUPABASE_ANON_KEY'];
  // Ohne Konfiguration läuft die App rein lokal weiter – das ist ein gültiger Zustand,
  // kein Fehler.
  if (typeof url !== 'string' || typeof key !== 'string' || url === '' || key === '') return null;
  return { url, key };
};

/** Ohne die Bibliothek zu laden prüfen, ob Sync überhaupt eingerichtet ist. */
export const hasSupabaseConfig = (): boolean => configOf() !== null;

/**
 * Die Supabase-Bibliothek wird dynamisch nachgeladen. Wer die App rein lokal nutzt,
 * lädt sie nie – sie ist größer als der gesamte Rest der Anwendung.
 */
export async function createSupabaseClient(): Promise<SupabaseClient | null> {
  const config = configOf();
  if (config === null) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.url, config.key);
}

/**
 * Legt den Vault serverseitig an oder übernimmt den vorhandenen. Ein zweites Gerät
 * bekommt hier den bestehenden Schlüsselbund – verpacktes Material, das ohne Passphrase
 * nichts preisgibt – und braucht danach nur noch die Passphrase.
 */
export async function ensureVault(
  client: SupabaseClient,
  vaultId: string,
  keyring: Keyring,
): Promise<{ vaultId: string; keyring: Keyring }> {
  const { data, error } = await client.rpc('ensure_vault', { p_vault_id: vaultId, p_keyring: keyring });
  if (error !== null) throw new Error(`Vault konnte nicht eingerichtet werden: ${error.message}`);
  return data as { vaultId: string; keyring: Keyring };
}

/**
 * Neuen Schlüsselbund hochladen, nachdem sich die Passphrase geändert hat. Der Server nimmt
 * nur eine geänderte Passphrase an, alles andere muss gleich bleiben (0006_change_passphrase.sql).
 */
export async function updateKeyring(client: SupabaseClient, keyring: Keyring): Promise<void> {
  const { error } = await client.rpc('update_keyring', { p_vault_id: keyring.vaultId, p_keyring: keyring });
  if (error !== null) throw new Error(`Passphrase konnte nicht geändert werden: ${error.message}`);
}

/**
 * Nachweis eintragen, dass dieses Gerät den Vault-Key hat – nur, wenn der Server noch keinen
 * kennt (Vaults von vor 0007). Ohne Nachweis dürfte bei der ersten Rotation jede Sitzung rotieren.
 */
export async function registerKeyCheck(client: SupabaseClient, keyring: Keyring, proof: string): Promise<void> {
  const { error } = await client.rpc('register_key_check', {
    p_vault_id: keyring.vaultId,
    p_key_version: keyring.keyVersion,
    p_proof: proof,
  });
  if (error !== null && error.code !== FUNCTION_MISSING_CODE) throw new Error(error.message);
}

/** Neuen Vault-Key beim Server hinterlegen (`rotate_vault_key`); widerruft alle API-Tokens. */
export async function rotateVaultKey(client: SupabaseClient, rotated: RotatedVault): Promise<void> {
  const { error } = await client.rpc('rotate_vault_key', {
    p_vault_id: rotated.keyring.vaultId,
    p_proof: rotated.oldProof,
    p_keyring: rotated.keyring,
    p_new_proof: rotated.newProof,
  });
  if (error === null) return;
  if (error.code === ENTITLEMENT_REQUIRED_CODE) throw new EntitlementRequiredError(error.message);
  throw new Error(`Schlüssel konnte nicht erneuert werden: ${error.message}`);
}

export class SupabaseSyncAdapter implements SyncAdapter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly vaultId: string,
  ) {}

  async push(records: readonly RemoteRecord[]): Promise<void> {
    if (records.length === 0) return;
    const { error } = await this.client.rpc('push_records', {
      p_vault_id: this.vaultId,
      p_records: records.map(({ id, hlc, iv, ct, keyVersion, deleted }) => ({ id, hlc, iv, ct, keyVersion, deleted })),
    });
    if (error === null) return;

    // PostgREST reicht den SQLSTATE der Funktion als `code` durch. Nur damit lässt sich
    // die fehlende Berechtigung von einem Netz- oder Serverproblem trennen.
    if (error.code === ENTITLEMENT_REQUIRED_CODE) throw new EntitlementRequiredError(error.message);
    if (error.code === VAULT_FORBIDDEN_CODE) throw new VaultForbiddenError(error.message);
    if (error.code === RECORD_QUOTA_CODE) throw new RecordQuotaError(error.message);
    if (error.code === KEY_OUTDATED_CODE) throw new KeyOutdatedError(error.message);
    throw new Error(`Push fehlgeschlagen: ${error.message}`);
  }

  async pull(cursor: number, limit: number): Promise<PullPage> {
    const { data, error } = await this.client
      .from('records')
      .select('id, hlc, iv, ct, key_version, deleted, server_seq')
      .eq('vault_id', this.vaultId)
      .gt('server_seq', cursor)
      .order('server_seq', { ascending: true })
      .limit(limit);
    if (error !== null) throw new Error(`Pull fehlgeschlagen: ${error.message}`);

    const rows = (data ?? []) as RecordRow[];
    return {
      records: rows.map(toRemote),
      cursor: rows.at(-1)?.server_seq ?? cursor,
      hasMore: rows.length === limit,
    };
  }

  async epoch(): Promise<string | null> {
    const { data, error } = await this.client.rpc('sync_epoch');
    if (error === null) return data as string;
    // In älteren Datenbanken gibt es die Funktion nicht. Das darf den Sync nicht anhalten, solange die
    // Migration noch nicht eingespielt ist.
    if (error.code === FUNCTION_MISSING_CODE) return null;
    throw new Error(`Server-Epoche nicht abrufbar: ${error.message}`);
  }

  async reencrypt(records: readonly ReencryptedRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const { data, error } = await this.client.rpc('reencrypt_records', {
      p_vault_id: this.vaultId,
      p_records: records.map(({ id, hlc, iv, ct, keyVersion }) => ({ id, hlc, iv, ct, keyVersion })),
    });
    if (error !== null) throw new Error(`Umschlüsseln fehlgeschlagen: ${error.message}`);
    return data as number;
  }

  subscribe(onChange: () => void): () => void {
    // Die Benachrichtigung trägt keine Nutzdaten – sie löst nur einen Pull aus.
    const channel = this.client
      .channel(`records:${this.vaultId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'records', filter: `vault_id=eq.${this.vaultId}` },
        onChange,
      )
      .subscribe();
    return () => void this.client.removeChannel(channel);
  }
}

const BUCKET = 'attachments';

/** HTTP-Status eines Storage-Fehlers; die Bibliothek hat ihn je nach Version an zwei Stellen. */
const statusOf = (error: unknown): number | null => {
  const e = error as { status?: unknown; statusCode?: unknown };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'string' && /^\d+$/.test(e.statusCode)) return Number(e.statusCode);
  return null;
};

/**
 * Anhänge im Storage-Bucket aus 0001_schema.sql. Zugriff regeln die Policies dort;
 * `uploadStatus` fragt vorher, damit ein verweigerter Upload einen verständlichen Grund hat.
 */
export class SupabaseBlobAdapter implements BlobAdapter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly vaultId: string,
  ) {}

  private full(path: string): string {
    return `${this.vaultId}/${path}`;
  }

  async uploadStatus(): Promise<BlobUploadStatus> {
    const { data, error } = await this.client.rpc('attachment_upload_status', { p_vault_id: this.vaultId });
    if (error !== null) {
      if (error.code === VAULT_FORBIDDEN_CODE) throw new VaultForbiddenError(error.message);
      throw new Error(`Anhang-Status nicht abrufbar: ${error.message}`);
    }
    return data as BlobUploadStatus;
  }

  async upload(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const { error } = await this.client.storage
      .from(BUCKET)
      // Der Server soll nicht einmal den Dateityp erfahren.
      .upload(this.full(path), new Blob([data]), { contentType: 'application/octet-stream', upsert: false });
    // 409: liegt schon dort, etwa nach einem abgebrochenen Lauf. Dateien ändern sich nie.
    if (error === null || statusOf(error) === 409) return;
    throw new Error(`Anhang konnte nicht hochgeladen werden: ${error.message}`);
  }

  async download(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const { data, error } = await this.client.storage.from(BUCKET).download(this.full(path));
    if (error !== null) {
      // Storage meldet fehlende Objekte je nach Version als 400 oder 404.
      const status = statusOf(error);
      if (status === 404 || status === 400) return null;
      throw new Error(`Anhang konnte nicht geladen werden: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async replace(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(this.full(path), new Blob([data]), { contentType: 'application/octet-stream', upsert: true });
    if (error !== null) throw new Error(`Anhang konnte nicht ersetzt werden: ${error.message}`);
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(BUCKET).remove(paths.map((p) => this.full(p)));
    if (error !== null) throw new Error(`Anhänge konnten nicht gelöscht werden: ${error.message}`);
  }
}
