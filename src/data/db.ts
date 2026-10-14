import Dexie, { type EntityTable } from 'dexie';
import type { Context, Task } from '@/domain/types';

/**
 * Inhalt eines Anhangs. Als ArrayBuffer statt Blob: Blobs in IndexedDB waren in Safari
 * lange unzuverlässig, und bei höchstens 5 MB kostet die Kopie im Speicher nichts.
 */
export interface BlobRow {
  id: string;
  data: ArrayBuffer;
}

/** Was noch zum Server geschoben werden muss. Ein Eintrag pro Record, nicht pro Änderung. */
export interface OutboxEntry {
  recordId: string;
  kind: 'task' | 'context';
  /** Reihenfolge des ersten Dirty-Markierens – hält den Push-Verlauf nachvollziehbar. */
  seq: number;
}

/**
 * Was mit einer Anhang-Datei auf dem Server noch passieren muss. Ein Eintrag je
 * Anhang: ein späteres `delete` ersetzt ein noch offenes `upload`, und umgekehrt beim Undo.
 */
export interface BlobQueueEntry {
  /** ID des Anhangs. */
  id: string;
  taskId: string;
  op: 'upload' | 'delete';
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class TidyDb extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  contexts!: EntityTable<Context, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'recordId'>;
  meta!: EntityTable<MetaRow, 'key'>;
  blobs!: EntityTable<BlobRow, 'id'>;
  blobQueue!: EntityTable<BlobQueueEntry, 'id'>;

  constructor(name = 'tidypepple') {
    super(name);
    this.version(1).stores({
      // `*contexts` ist ein Multi-Entry-Index: Filtern nach Kontext läuft über den Index,
      // nicht über einen Full-Table-Scan.
      // `deletedAt` ist absichtlich nicht indiziert: IndexedDB indiziert `null` nicht, ein
      // Index darauf fände nur Tombstones und niemals die lebenden Records.
      tasks: 'id, status, parentId, dueDate, createdAt, *contexts',
      contexts: 'id, order',
      outbox: 'recordId, seq',
      meta: 'key',
    });
    // Neues Pflichtfeld: bestehende Aufgaben bekommen den Standardwert, statt `undefined`.
    this.version(2).upgrade((tx) =>
      tx
        .table<Task>('tasks')
        .toCollection()
        .modify((task) => {
          task.highPriority ??= false;
        }),
    );
    // Anhänge: eigene Tabelle für die Dateien, Metadaten an der Aufgabe.
    this.version(3)
      .stores({ blobs: 'id' })
      .upgrade((tx) =>
        tx
          .table<Task>('tasks')
          .toCollection()
          .modify((task) => {
            task.attachments ??= [];
          }),
      );
    // Anhänge synchronisieren: alles, was in Stufe 1 nur lokal angehängt wurde, wartet
    // jetzt auf den Upload. Ohne Datei auf dem Gerät verwirft der Upload den Eintrag.
    this.version(4)
      .stores({ blobQueue: 'id' })
      .upgrade(async (tx) => {
        const tasks = await tx.table<Task>('tasks').toArray();
        await tx.table<BlobQueueEntry>('blobQueue').bulkPut(
          tasks.flatMap((task) => task.attachments.map((a) => ({ id: a.id, taskId: task.id, op: 'upload' as const }))),
        );
      });
    // Tags: gefiltert wird im Speicher, deshalb ohne Index.
    this.version(5).upgrade((tx) =>
      tx
        .table<Task>('tasks')
        .toCollection()
        .modify((task) => {
          task.tags ??= [];
        }),
    );
  }
}

export const db = new TidyDb();

export const META_KEYS = {
  deviceId: 'deviceId',
  clock: 'clock',
  outboxSeq: 'outboxSeq',
  pullCursor: 'pullCursor',
  // Kennung des Server-Datenbestands beim letzten Sync – wechselt nach einem Restore (`sync_epoch`).
  serverEpoch: 'serverEpoch',
  // Vault, mit dem die lokalen Daten abgeglichen werden. Cursor, Epoche und Outbox gelten
  // nur für ihn (`bindVault` in repo.ts).
  syncVaultId: 'syncVaultId',
  lastSyncAt: 'lastSyncAt',
  sort: 'sort',
  contextFilter: 'contextFilter',
  tagFilter: 'tagFilter',
  priorityFilter: 'priorityFilter',
  collapsedContexts: 'collapsedContexts',
  collapsedStatuses: 'collapsedStatuses',
  // Die Ansicht "All" merkt sich Sortierung, Filter und Abschnitte getrennt von "Next".
  allSort: 'allSort',
  allContextFilter: 'allContextFilter',
  allTagFilter: 'allTagFilter',
  allPriorityFilter: 'allPriorityFilter',
  allStatusFilter: 'allStatusFilter',
  allCollapsedContexts: 'allCollapsedContexts',
  allCollapsedStatuses: 'allCollapsedStatuses',
  // Hinweis "nur in diesem Browser gespeichert" wurde gelesen.
  storageNoticeSeen: 'storageNoticeSeen',
  // versionCode, zu dem der Update-Hinweis der Android-App weggeklickt wurde (Phase 7).
  appUpdateDismissed: 'appUpdateDismissed',
} as const;

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row === undefined ? undefined : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
