import type { RemoteRecord, SyncAdapter } from './adapter';
import type { BlobSync } from './blobs';
import { isEntitlementRequired } from './errors';
import { open, seal, type Envelope } from '@/crypto/envelope';
import { isValidHlc } from '@/domain/hlc';
import { getMeta, META_KEYS, setMeta } from '@/data/db';
import {
  applyRemoteChanges,
  applyRemoteTombstone,
  bindVault,
  confirmPushed,
  mergeDuplicateContexts,
  onLocalChange,
  pendingRecords,
  resyncAll,
  type PendingRecord,
  type RecordKind,
  type RemoteChange,
} from '@/data/repo';
import type { Context, Task } from '@/domain/types';

/**
 * Push/Pull gegen einen beliebigen `SyncAdapter`.
 *
 * Die Art des Records (`task` oder `context`) steckt mit im Ciphertext, nicht in einer
 * Spalte: der Server soll nicht einmal wissen, ob ein Blob eine Aufgabe oder ein Kontext ist.
 */

const PAGE_SIZE = 200;

/** Ruhe nach einer lokalen Änderung, bevor geschoben wird – Tippen soll nicht jede Sekunde pushen. */
const LOCAL_CHANGE_DELAY_MS = 1500;

/**
 * Inhalt eines Records auf dem Server. Eine Löschung trägt nur, was sie braucht: der Inhalt
 * einer gelöschten Aufgabe verlässt das Gerät nicht mehr, und die Uhr der Löschung steht im
 * authentifizierten Ciphertext – nicht in der Klartextspalte, die der Server ändern könnte.
 */
type SealedPayload =
  | { kind: RecordKind; value: Task | Context }
  | { kind: RecordKind; tombstone: { deletedAt: number; hlc: string } };

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Nicht entschlüsselbare Records – etwa aus einem Vault mit anderem Schlüssel. */
  undecryptable: number;
  /**
   * Der Server hat das Hochladen verweigert, weil kein aktives Abo vorliegt.
   * Kein Fehlerfall: Herunterladen läuft weiter, und die Outbox bleibt erhalten.
   */
  pushBlocked: boolean;
  /** Hochgeladene Anhang-Dateien. */
  filesUploaded: number;
  /** Anhänge konnten nicht hochgeladen werden: kein Abo oder Kontingent voll. */
  filesBlocked: 'entitlement' | 'quota' | null;
}

const NOTHING: SyncResult = {
  pushed: 0,
  pulled: 0,
  undecryptable: 0,
  pushBlocked: false,
  filesUploaded: 0,
  filesBlocked: null,
};

export interface VaultAccess {
  key: () => CryptoKey;
  keyVersion: () => number;
  /** Der Vault, zu dem der Schlüssel gehört: Cursor, Epoche und Outbox gelten nur für ihn. */
  vaultId: () => string;
}

/** Zwei Läufe zu einem Ergebnis: Zähler addieren, Sperren gelten wie im letzten Lauf. */
const combine = (a: SyncResult, b: SyncResult): SyncResult => ({
  pushed: a.pushed + b.pushed,
  pulled: a.pulled + b.pulled,
  undecryptable: a.undecryptable + b.undecryptable,
  pushBlocked: b.pushBlocked,
  filesUploaded: a.filesUploaded + b.filesUploaded,
  filesBlocked: b.filesBlocked,
});

export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  /** Während eines Laufs kam ein neuer Anlass – er braucht einen weiteren Durchgang. */
  private again = false;

  constructor(
    private readonly adapter: SyncAdapter,
    private readonly vault: VaultAccess,
    /** Ohne: Anhänge bleiben auf dem Gerät. Ihre Metadaten reisen trotzdem mit der Aufgabe. */
    private readonly blobs?: BlobSync,
  ) {}

  /**
   * Ein vollständiger Durchlauf: erst schieben, dann holen. Diese Reihenfolge sorgt dafür,
   * dass eigene Änderungen beim Konflikt mit demselben HLC-Vergleich bewertet werden,
   * den der Server anwendet – sonst könnte ein Pull lokale Arbeit überschreiben, die
   * nie beim Server ankam.
   */
  syncOnce(): Promise<SyncResult> {
    // Ein Anlass während eines Laufs (Realtime-Signal, lokale Änderung) darf nicht verfallen:
    // der Pull könnte schon vorbei sein. Er hängt einen Durchgang an den laufenden an.
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let result = NOTHING;
      do {
        this.again = false;
        result = combine(result, await this.runOnce());
      } while (this.again);
      return result;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<SyncResult> {
    // Zuerst: Gehören die lokalen Daten überhaupt zu diesem Vault? Nach einem Wechsel wird
    // der alte Bestand verworfen, und Cursor wie Epoche beginnen für den neuen von vorn.
    await bindVault(this.vault.vaultId());
    await this.checkEpoch();
    let { pushed, blocked } = await this.pushAll();
    // Auch ohne Abo weiter herunterladen: sonst käme jemand, dessen Abo ausgelaufen ist,
    // auf einem neuen Gerät nicht mehr an die eigenen Daten.
    const { pulled, undecryptable } = await this.pullAll();
    // Erst nach dem Pull sieht dieses Gerät die Kontexte der anderen. Die Zusammenführung
    // geht gleich mit hinaus, damit die anderen Geräte nicht auf den nächsten Anlass warten.
    if ((await mergeDuplicateContexts()) > 0 && !blocked) {
      const merged = await this.pushAll();
      pushed += merged.pushed;
      blocked = merged.blocked;
    }
    await setMeta(META_KEYS.lastSyncAt, Date.now());

    // Dateien zuletzt: ein paar Megabyte Upload sollen Aufgaben nicht aufhalten. Ein
    // anderes Gerät sieht den Anhang dann kurz als "noch nicht hochgeladen".
    const files = (await this.blobs?.run()) ?? { uploaded: 0, removed: 0, blocked: null };
    return {
      pushed,
      pulled,
      undecryptable,
      pushBlocked: blocked,
      filesUploaded: files.uploaded,
      filesBlocked: files.blocked,
    };
  }

  /**
   * Wurde auf dem Server ein Backup eingespielt, passt der Pull-Cursor nicht mehr, und was
   * seit dem Backup hochgeladen war, fehlt dort. Dann alles noch einmal – vor dem Push,
   * damit derselbe Lauf es schon hinausschiebt.
   */
  private async checkEpoch(): Promise<void> {
    const current = (await this.adapter.epoch?.()) ?? null;
    if (current === null) return;
    const known = await getMeta<string>(META_KEYS.serverEpoch);
    if (known === current) return;
    // Beim ersten Mal gibt es nichts zu vergleichen: ein neues Gerät holt ohnehin ab 0, und
    // ein bestehendes hat vor diesem Update denselben Bestand gesehen.
    if (known !== undefined) await resyncAll();
    await setMeta(META_KEYS.serverEpoch, current);
  }

  private async pushAll(): Promise<{ pushed: number; blocked: boolean }> {
    let total = 0;
    for (;;) {
      const pending = await pendingRecords(PAGE_SIZE);
      if (pending.length === 0) return { pushed: total, blocked: false };

      const sealed = await Promise.all(pending.map((record) => this.sealRecord(record)));
      try {
        await this.adapter.push(sealed);
      } catch (cause) {
        // Fehlende Berechtigung ist kein Abbruchgrund. Die Outbox bleibt unangetastet und
        // läuft voll – nach einem Abschluss wird alles nachgeschoben, nichts geht verloren.
        // Jeder andere Fehler (Netz, Server) muss weiterhin durchschlagen, damit er nicht
        // stillschweigend als "nicht bezahlt" durchgeht.
        if (isEntitlementRequired(cause)) return { pushed: total, blocked: true };
        throw cause;
      }
      await confirmPushed(pending);
      total += pending.length;

      if (pending.length < PAGE_SIZE) return { pushed: total, blocked: false };
    }
  }

  private async sealRecord(record: PendingRecord): Promise<RemoteRecord> {
    const { deletedAt } = record.value;
    const payload: SealedPayload =
      deletedAt === null
        ? { kind: record.kind, value: record.value }
        : { kind: record.kind, tombstone: { deletedAt, hlc: record.hlc } };
    const envelope: Envelope = await seal(this.vault.key(), record.id, this.vault.keyVersion(), payload);
    return {
      id: record.id,
      hlc: record.hlc,
      ...envelope,
      // Nur zur Auskunft für den Server (Statistik, spätere Aufräumarbeiten). Der Client
      // verlässt sich nie darauf, sondern liest die Löschung aus dem Ciphertext.
      deleted: record.value.deletedAt !== null,
      serverSeq: null,
    };
  }

  private async pullAll(): Promise<{ pulled: number; undecryptable: number }> {
    let pulled = 0;
    let undecryptable = 0;

    for (;;) {
      const cursor = (await getMeta<number>(META_KEYS.pullCursor)) ?? 0;
      const page = await this.adapter.pull(cursor, PAGE_SIZE);
      if (page.records.length === 0) return { pulled, undecryptable };

      const changes: RemoteChange[] = [];
      for (const record of page.records) {
        // Leerer Ciphertext stammt von einem früheren Aufräumjob auf dem Server. Ihm zu
        // folgen hieße, dem Server zu glauben, was er löschen will – und das könnte er für
        // jede Aufgabe behaupten. Er wird wie ein unlesbarer Record übersprungen.
        if (record.ct === '') {
          undecryptable += 1;
          continue;
        }
        try {
          const payload = await open<SealedPayload>(this.vault.key(), record.id, {
            iv: record.iv,
            ct: record.ct,
            keyVersion: record.keyVersion,
          });
          if ('tombstone' in payload) {
            const { deletedAt, hlc } = payload.tombstone;
            if (!isValidHlc(hlc) || typeof deletedAt !== 'number') throw new Error('Ungültige Löschung');
            if (await applyRemoteTombstone(payload.kind, record.id, hlc, deletedAt)) pulled += 1;
          } else {
            changes.push({ kind: payload.kind, value: payload.value });
          }
        } catch {
          // Der Cursor läuft trotzdem weiter: sonst bliebe der Sync an einem einzigen
          // unlesbaren Record für immer stehen.
          undecryptable += 1;
        }
      }

      pulled += await applyRemoteChanges(changes);
      await setMeta(META_KEYS.pullCursor, page.cursor);
      if (!page.hasMore) return { pulled, undecryptable };
    }
  }

  /** Reagiert auf eigene und fremde Änderungen, Netzrückkehr und Rückkehr in den Tab. */
  start(onResult?: (result: SyncResult) => void, onError?: (error: unknown) => void): () => void {
    const run = (): void => {
      // Ohne dieses `catch` verschwindet jeder Fehler aus einem Hintergrundlauf als
      // unbehandelte Rejection – der Nutzer sähe nie, dass der Sync nicht läuft.
      void this.syncOnce()
        .then((result) => onResult?.(result))
        .catch((cause: unknown) => onError?.(cause));
    };

    const unsubscribe = this.adapter.subscribe?.(run);
    // Eigene Änderungen gehen nach kurzer Ruhe hinaus, nicht erst beim nächsten Tab-Wechsel.
    let pendingLocal: ReturnType<typeof setTimeout> | undefined;
    const stopLocal = onLocalChange(() => {
      clearTimeout(pendingLocal);
      pendingLocal = setTimeout(run, LOCAL_CHANGE_DELAY_MS);
    });
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    run();

    return () => {
      unsubscribe?.();
      stopLocal();
      clearTimeout(pendingLocal);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
}
