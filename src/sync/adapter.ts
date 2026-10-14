/**
 * Die Schnittstelle zum Server. Absichtlich winzig: bei Ende-zu-Ende-Verschlüsselung ist
 * der Server nur ein Ablageort für undurchsichtige Blobs mit einem Sortierschlüssel.
 * Deshalb ist Supabase austauschbar – und Tests laufen gegen einen Adapter im Speicher.
 */

export interface RemoteRecord {
  /** Record-ID des Clients; identisch mit `Task.id` bzw. `Context.id`. */
  id: string;
  /** Hybrid Logical Clock – lexikografisch vergleichbar, auch für den Server. */
  hlc: string;
  iv: string;
  /**
   * Verschlüsselter Inhalt. **Leer** kam früher von einem früheren Aufräumjob auf dem Server; der Client
   * überspringt so einen Record, denn eine unverschlüsselte Löschung könnte jeder behaupten.
   */
  ct: string;
  keyVersion: number;
  /**
   * Klartext-Markierung, dass dieser Record gelöscht ist. Der Server kann das sonst nicht
   * erkennen, weil `deletedAt` im Ciphertext steckt. Maßgeblich ist sie für den Client nie,
   * er liest die Löschung aus dem Ciphertext.
   */
  deleted: boolean;
  /** Vom Server vergebene, monoton steigende Nummer; beim Push `null`. */
  serverSeq: number | null;
}

export interface PullPage {
  records: readonly RemoteRecord[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncAdapter {
  /**
   * Schreibt Records. Der Server verwirft dabei jeden Record, dessen `hlc` nicht neuer ist
   * als der gespeicherte – so kann ein langsamer Nachzügler einen neueren Stand nicht
   * überschreiben, ohne dass der Server den Inhalt kennen müsste.
   */
  push(records: readonly RemoteRecord[]): Promise<void>;
  pull(cursor: number, limit: number): Promise<PullPage>;
  /**
   * Optional: Kennung des Datenbestands auf dem Server. Sie wechselt, wenn ein Backup
   * eingespielt wurde – dann passen die Cursor der Geräte nicht mehr (`sync_epoch` in 0001_schema.sql).
   * `null`, wenn der Server keine Epoche kennt.
   */
  epoch?(): Promise<string | null>;
  /** Optional: meldet fremde Änderungen, damit nicht gepollt werden muss. */
  subscribe?(onChange: () => void): () => void;
}

/** Was der Server zum Hochladen von Anhängen sagt, bevor es versucht wird. */
export type BlobUploadStatus = 'ok' | 'entitlement' | 'quota';

/**
 * Ablage für verschlüsselte Anhänge. Pfade sind relativ zum Vault:
 * `<task_id>/<attachment_id>` – der Adapter kennt den Vault selbst.
 */
export interface BlobAdapter {
  uploadStatus(): Promise<BlobUploadStatus>;
  /** Idempotent: liegt die Datei schon dort, ist das kein Fehler. */
  upload(path: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  /** `null`, wenn es die Datei (noch) nicht gibt – etwa weil ein anderes Gerät noch hochlädt. */
  download(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Fehlende Dateien sind kein Fehler. */
  remove(paths: readonly string[]): Promise<void>;
}
