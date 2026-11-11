import type { BlobAdapter, BlobUploadStatus, PullPage, ReencryptedRecord, RemoteRecord, SyncAdapter } from './adapter';
import { EntitlementRequiredError, KeyOutdatedError } from './errors';
import { isNewer } from '@/domain/hlc';

/**
 * Adapter im Speicher – bildet die Server-Semantik nach (monotone `server_seq`,
 * HLC-Vergleich beim Schreiben). Damit lässt sich Konvergenz zwischen zwei Clients testen,
 * ohne eine echte Datenbank zu starten.
 */
export class MemorySyncAdapter implements SyncAdapter {
  private records = new Map<string, RemoteRecord>();
  private seq = 0;
  private currentEpoch = 'epoch-1';
  private readonly listeners = new Set<() => void>();

  /**
   * Bildet die Abo-Sperre des Servers nach. So lässt sich prüfen, dass ein gesperrter
   * Push den Pull nicht verhindert und die Outbox erhalten bleibt.
   */
  blockPush = false;

  /**
   * Aktuelle Schlüsselversion des Vaults, wie im Schlüsselbund auf dem Server. Gesetzt weist
   * der Push jede andere ab – wie `write_records` nach einer Rotation.
   */
  keyVersion: number | null = null;

  async push(records: readonly RemoteRecord[]): Promise<void> {
    if (this.blockPush) throw new EntitlementRequiredError();
    if (this.keyVersion !== null && records.some((r) => r.keyVersion !== this.keyVersion)) throw new KeyOutdatedError();
    let changed = false;
    for (const record of records) {
      const existing = this.records.get(record.id);
      // Dieselbe Regel wie in `push_records()` auf dem Server.
      if (existing !== undefined && !isNewer(record.hlc, existing.hlc)) continue;
      this.seq += 1;
      this.records.set(record.id, { ...record, serverSeq: this.seq });
      changed = true;
    }
    if (changed) for (const listener of this.listeners) listener();
  }

  async pull(cursor: number, limit: number): Promise<PullPage> {
    const page = [...this.records.values()]
      .filter((r) => (r.serverSeq ?? 0) > cursor)
      .sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0));
    const slice = page.slice(0, limit);
    return {
      records: slice,
      cursor: slice.at(-1)?.serverSeq ?? cursor,
      hasMore: page.length > slice.length,
    };
  }

  /** Wie `reencrypt_records`: gleicher HLC, ältere Version, und `serverSeq` bleibt. */
  async reencrypt(records: readonly ReencryptedRecord[]): Promise<number> {
    let count = 0;
    for (const record of records) {
      const existing = this.records.get(record.id);
      if (existing === undefined || existing.hlc !== record.hlc) continue;
      if (this.keyVersion !== null && record.keyVersion !== this.keyVersion) continue;
      if (existing.keyVersion >= record.keyVersion) continue;
      this.records.set(record.id, { ...existing, iv: record.iv, ct: record.ct, keyVersion: record.keyVersion });
      count += 1;
    }
    return count;
  }

  /** Alle Records, wie sie gerade auf dem "Server" liegen – für Tests. */
  all(): RemoteRecord[] {
    return [...this.records.values()];
  }

  async epoch(): Promise<string> {
    return this.currentEpoch;
  }

  /** Stand für einen späteren `restore` – wie ein Backup der Datenbank. */
  backup(): { records: Map<string, RemoteRecord>; seq: number } {
    return { records: new Map(this.records), seq: this.seq };
  }

  /** Spielt ein Backup ein und setzt eine neue Epoche – wie die Anleitung in docs/restore.md. */
  restore(backup: { records: Map<string, RemoteRecord>; seq: number }): void {
    this.records = new Map(backup.records);
    this.seq = backup.seq;
    this.currentEpoch = `${this.currentEpoch}+`;
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}

/** Anhang-Ablage im Speicher, mit denselben Regeln wie die Policies in 0001_schema.sql. */
export class MemoryBlobAdapter implements BlobAdapter {
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>();
  status: BlobUploadStatus = 'ok';

  async uploadStatus(): Promise<BlobUploadStatus> {
    return this.status;
  }

  async upload(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.status !== 'ok') throw new Error(`Upload verweigert: ${this.status}`);
    // Kein Überschreiben – wie auf dem Server.
    if (!this.files.has(path)) this.files.set(path, data);
  }

  async download(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.files.get(path) ?? null;
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.files.delete(path);
  }

  async replace(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.status === 'entitlement') throw new Error('Ersetzen verweigert: entitlement');
    this.files.set(path, data);
  }
}
