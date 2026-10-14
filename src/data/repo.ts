import { generateKeyBetween } from 'fractional-indexing';
import { db, META_KEYS, type OutboxEntry } from './db';
import { formatHlc, isNewer, isValidHlc, merge as mergeHlc, tick, type HlcState } from '@/domain/hlc';
import { newDeviceId, uuidv7 } from '@/domain/ids';
import { buildGraph, childrenOf, selfAndDescendantIds, shouldAutoPromote } from '@/domain/projects';
import { isLive, normalizeContext, normalizeTask, type Attachment, type Context, type Task, type TaskDraft, type TaskStatus } from '@/domain/types';

/**
 * Alle Schreibvorgänge laufen durch dieses Modul. Es garantiert drei Dinge, auf die der
 * Sync später baut, ohne dass die UI davon etwas weiß:
 *
 *   1. jeder Record trägt einen frischen HLC-Zeitstempel,
 *   2. jede Änderung markiert den Record in der Outbox,
 *   3. Löschen ist immer ein Soft Delete (Tombstone).
 *
 * Deshalb ist die App offline vollständig funktionsfähig und der Sync ein Zusatz.
 */

let clock: HlcState | null = null;
let outboxSeq = 0;

const localChangeListeners = new Set<() => void>();

/**
 * Meldet, dass eine lokale Änderung in der Outbox liegt – nach dem Commit, damit ein
 * daraufhin gestarteter Push sie auch sieht. Fremde Änderungen aus dem Sync melden nichts.
 */
export function onLocalChange(listener: () => void): () => void {
  localChangeListeners.add(listener);
  return () => localChangeListeners.delete(listener);
}

/** Lädt Geräte-ID und Uhr, oder legt sie beim ersten Start an. Idempotent. */
export async function initRepo(): Promise<void> {
  if (clock !== null) return;
  await db.transaction('rw', db.meta, async () => {
    const existingDevice = await db.meta.get(META_KEYS.deviceId);
    const deviceId = (existingDevice?.value as string | undefined) ?? newDeviceId();
    if (existingDevice === undefined) await db.meta.put({ key: META_KEYS.deviceId, value: deviceId });

    const stored = (await db.meta.get(META_KEYS.clock))?.value as HlcState | undefined;
    clock = stored ?? { millis: 0, counter: 0, deviceId };
    // Fremde Geräte-ID (z. B. nach Import) darf die eigene Uhr nicht übernehmen.
    clock = { ...clock, deviceId };

    outboxSeq = ((await db.meta.get(META_KEYS.outboxSeq))?.value as number | undefined) ?? 0;
  });
}

function requireClock(): HlcState {
  if (clock === null) throw new Error('initRepo() muss vor Schreibvorgängen laufen.');
  return clock;
}

/**
 * Zentrale Schreiboperation: Zeitstempel setzen, Record schreiben, Outbox markieren –
 * alles in einer Transaktion, damit kein Record ohne Outbox-Eintrag existieren kann.
 */
async function mutate<T>(
  fn: (ctx: { hlc: string; now: number; stamp: <R extends { hlc: string }>(r: R) => R; dirty: (kind: OutboxEntry['kind'], id: string) => void }) => Promise<T>,
): Promise<T> {
  await initRepo();
  let dirtied = false;

  const result = await db.transaction('rw', db.tasks, db.contexts, db.outbox, db.meta, async () => {
    // Die Uhr tickt erst hier: Transaktionen auf `meta` laufen nacheinander, also hat ein
    // gleichzeitiger Pull die Uhr bereits nachgezogen. Vorher getickt bekäme diese Änderung
    // einen älteren Stempel als der fremde Stand, auf dem sie aufsetzt – und der Server
    // verwürfe sie, während die Outbox sie als gesendet abhakt.
    const now = Date.now();
    const next = tick(requireClock(), now);
    clock = next;
    const hlc = formatHlc(next);
    const dirtyRecords: OutboxEntry[] = [];

    const value = await fn({
      hlc,
      now,
      stamp: (r) => ({ ...r, hlc }),
      dirty: (kind, id) => {
        outboxSeq += 1;
        dirtyRecords.push({ recordId: id, kind, seq: outboxSeq });
      },
    });
    if (dirtyRecords.length > 0) {
      // `put` statt `add`: ein bereits offener Eintrag behält seine Position nicht, aber
      // Dedup pro Record ist wichtiger – gepusht wird immer der aktuelle Stand.
      await db.outbox.bulkPut(dirtyRecords);
      dirtied = true;
    }
    await db.meta.bulkPut([
      { key: META_KEYS.clock, value: next },
      { key: META_KEYS.outboxSeq, value: outboxSeq },
    ]);
    return value;
  });

  if (dirtied) for (const listener of localChangeListeners) listener();
  return result;
}

const emptyTask = (id: string, now: number, hlc: string): Task => ({
  id,
  title: '',
  notes: '',
  status: 'inbox',
  parentId: null,
  order: 'a0',
  listOrder: null,
  contexts: [],
  tags: [],
  dueDate: null,
  dueTime: null,
  deferDate: null,
  reminderAt: null,
  projectMode: 'sequential',
  pinnedAsProject: false,
  waitingFor: null,
  waitingSince: null,
  highPriority: false,
  attachments: [],
  completedAt: null,
  createdAt: now,
  deletedAt: null,
  hlc,
});

/**
 * Nächster freier Fractional Index am Ende der Geschwisterreihe.
 *
 * IndexedDB indiziert `null` nicht: Wurzelaufgaben stehen nicht im `parentId`-Index und
 * wären über `where('parentId')` unsichtbar. Für sie wird deshalb gefiltert statt indiziert.
 */
async function siblingsOf(parentId: string | null): Promise<Task[]> {
  return parentId === null
    ? db.tasks.filter((t) => t.parentId === null).toArray()
    : db.tasks.where('parentId').equals(parentId).toArray();
}

async function orderAtEnd(parentId: string | null): Promise<string> {
  const siblings = await siblingsOf(parentId);
  const orders = siblings.filter(isLive).map((t) => t.order).sort();
  return generateKeyBetween(orders.at(-1) ?? null, null);
}

/**
 * `waitingSince` und `completedAt` folgen dem Status: ein Wechsel auf 'waiting' startet die
 * Wartezeit, jeder andere Status beendet sie; ein Wechsel auf 'done' setzt den
 * Erledigt-Zeitpunkt, jeder andere löscht ihn – auch über die Statusauswahl im Detail.
 * Beim Erledigen fallen Fälligkeit und Erinnerung weg, sonst stünde Erledigtes als überfällig da.
 * Ein Patch, der das Feld selbst mitbringt (Sicherung, Teilen, Undo), behält seinen Wert.
 */
function withStatusStamps<P extends Partial<Task>>(patch: P, previous: TaskStatus | null, now: number): P {
  if (patch.status === undefined || patch.status === previous) return patch;
  const stamps: Partial<Task> = {
    completedAt: patch.status === 'done' ? now : null,
    waitingSince: patch.status === 'waiting' ? now : null,
    ...(patch.status === 'done' && { dueDate: null, dueTime: null, reminderAt: null }),
  };
  const missing = Object.entries(stamps).filter(([key]) => patch[key as keyof Task] === undefined);
  return { ...Object.fromEntries(missing), ...patch };
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  return mutate(async ({ hlc, now, dirty }) => {
    const id = uuidv7(now);
    const parentId = draft.parentId ?? null;
    const task: Task = {
      ...emptyTask(id, now, hlc),
      ...withStatusStamps(draft, null, now),
      id,
      parentId,
      order: draft.order ?? (await orderAtEnd(parentId)),
      createdAt: now,
      hlc,
    };
    await db.tasks.put(task);
    dirty('task', id);
    return task;
  });
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt' | 'hlc'>>): Promise<void> {
  await mutate(async ({ hlc, now, dirty }) => {
    const existing = await db.tasks.get(id);
    if (existing === undefined) return;
    await db.tasks.put({ ...existing, ...withStatusStamps(patch, existing.status, now), id, createdAt: existing.createdAt, hlc });
    dirty('task', id);
  });
}

export async function setStatus(id: string, status: TaskStatus): Promise<void> {
  await updateTask(id, { status, completedAt: status === 'done' ? Date.now() : null });
}

export const completeTask = (id: string): Promise<void> => setStatus(id, 'done');

/** Undo fürs Erledigen: stellt Status, Wartezeit, Fälligkeit und Erinnerung von vorher wieder her. */
export async function undoComplete(before: Task): Promise<void> {
  const { status, waitingSince, dueDate, dueTime, reminderAt } = before;
  await updateTask(before.id, { status, waitingSince, dueDate, dueTime, reminderAt, completedAt: null });
}

/** Erledigen zurücknehmen. Der Status davor ist nicht gespeichert – `next` ist die sichere Annahme. */
export const reopenTask = (id: string): Promise<void> => setStatus(id, 'next');

/**
 * Soft Delete inklusive Nachkommen: ein Projekt zu löschen und verwaiste Schritte
 * zurückzulassen wäre für den Nutzer nicht nachvollziehbar.
 */
export const deleteTask = (id: string): Promise<readonly string[]> => deleteTasks([id]);

/** Mehrere Aufgaben in einem Schritt löschen – ein Undo nimmt alle zurück. */
export async function deleteTasks(rootIds: readonly string[]): Promise<readonly string[]> {
  return mutate(async ({ hlc, now, dirty }) => {
    const all = await db.tasks.toArray();
    const graph = buildGraph(all);
    const ids: string[] = [];
    const walk = (taskId: string): void => {
      if (ids.includes(taskId)) return;
      ids.push(taskId);
      for (const child of childrenOf(graph, taskId)) walk(child.id);
    };
    for (const id of rootIds) walk(id);

    const updated = ids
      .map((i) => graph.byId.get(i))
      .filter((t): t is Task => t !== undefined)
      .map((t) => ({ ...t, deletedAt: now, hlc }));
    await db.tasks.bulkPut(updated);
    for (const t of updated) dirty('task', t.id);
    return updated.map((t) => t.id);
  });
}

/** Rücknahme des Löschens (Undo-Toast). */
export async function restoreTasks(ids: readonly string[]): Promise<void> {
  await mutate(async ({ hlc, dirty }) => {
    const tasks = (await db.tasks.bulkGet([...ids])).filter((t): t is Task => t !== undefined);
    await db.tasks.bulkPut(tasks.map((t) => ({ ...t, deletedAt: null, hlc })));
    for (const t of tasks) dirty('task', t.id);
  });
}

/**
 * Anhang-Metadaten innerhalb der Transaktion lesen und schreiben – ein `updateTask` mit
 * vorher gelesener Liste könnte eine gleichzeitige Änderung überschreiben.
 */
export async function addAttachmentMeta(taskId: string, attachment: Attachment): Promise<void> {
  await mutate(async ({ hlc, dirty }) => {
    const existing = await db.tasks.get(taskId);
    if (existing === undefined) return;
    await db.tasks.put({ ...existing, attachments: [...existing.attachments, attachment], hlc });
    dirty('task', taskId);
  });
}

export async function removeAttachmentMeta(taskId: string, attachmentId: string): Promise<void> {
  await mutate(async ({ hlc, dirty }) => {
    const existing = await db.tasks.get(taskId);
    if (existing === undefined) return;
    await db.tasks.put({ ...existing, attachments: existing.attachments.filter((a) => a.id !== attachmentId), hlc });
    dirty('task', taskId);
  });
}

export interface AddStepResult {
  step: Task;
  /** `true`, wenn der Elternteil durch diesen Schritt zum Projekt geworden ist. */
  promoted: boolean;
}

/**
 * Fügt einem Task einen nächsten Schritt hinzu und befördert ihn schon beim ersten Schritt
 * automatisch zum Projekt. Die Beförderung wird dauerhaft festgehalten, damit ein Projekt
 * mit erledigten Schritten nicht stillschweigend in die Aktionsliste zurückfällt.
 */
export async function addStep(parentId: string, draft: TaskDraft): Promise<AddStepResult> {
  const step = await createTask({ status: 'next', ...draft, parentId });
  const graph = buildGraph(await db.tasks.toArray());
  const parent = graph.byId.get(parentId);
  if (parent !== undefined && shouldAutoPromote(graph, parent)) {
    await updateTask(parentId, { pinnedAsProject: true, status: parent.status === 'inbox' ? 'next' : parent.status });
    return { step, promoted: true };
  }
  return { step, promoted: false };
}

export const setProjectPinned = (id: string, pinned: boolean): Promise<void> =>
  updateTask(id, { pinnedAsProject: pinned });

/**
 * Verschiebt eine Aufgabe zwischen zwei Geschwistern (Drag & Drop in Liste und Board).
 * `beforeId`/`afterId` sind die neuen Nachbarn; `null` bedeutet Rand.
 */
export async function moveTask(
  id: string,
  target: { parentId?: string | null; afterId?: string | null; beforeId?: string | null },
): Promise<void> {
  const task = await db.tasks.get(id);
  if (task === undefined) return;
  const parentId = target.parentId === undefined ? task.parentId : target.parentId;

  const after = target.afterId != null ? await db.tasks.get(target.afterId) : undefined;
  const before = target.beforeId != null ? await db.tasks.get(target.beforeId) : undefined;
  const order = generateKeyBetween(after?.order ?? null, before?.order ?? null);

  await updateTask(id, { parentId, order });
}

/** Schreibt neue Listenpositionen (siehe `planReorder`); `order` und Projektbezug bleiben. */
export async function setListOrders(updates: readonly { id: string; listOrder: string }[]): Promise<void> {
  for (const { id, listOrder } of updates) await updateTask(id, { listOrder });
}

/**
 * Ordnet eine Aufgabe einem Projekt zu (`null`: keinem) und stellt sie dort ans Ende der
 * Schritte. Ziele unterhalb der Aufgabe selbst werden abgelehnt – sie hinge sonst in einem
 * Kreis und aus jeder Ansicht heraus. Wie bei `addStep` befördert schon der erste Schritt zum Projekt.
 */
export async function setParent(id: string, parentId: string | null): Promise<boolean> {
  const before = buildGraph(await db.tasks.toArray());
  const task = before.byId.get(id);
  if (task === undefined) return false;
  if (task.parentId === parentId) return true;
  if (parentId !== null && (!before.byId.has(parentId) || selfAndDescendantIds(before, id).has(parentId))) return false;

  await updateTask(id, { parentId, order: await orderAtEnd(parentId) });
  if (parentId === null) return true;
  const after = buildGraph(await db.tasks.toArray());
  const parent = after.byId.get(parentId);
  if (parent !== undefined && shouldAutoPromote(after, parent)) {
    await updateTask(parentId, { pinnedAsProject: true, status: parent.status === 'inbox' ? 'next' : parent.status });
  }
  return true;
}

/**
 * Sucht ein offenes Projekt (oder eine Aufgabe) dieses Namens, ohne Rücksicht auf Groß- und
 * Kleinschreibung, und legt es sonst an. Eine gefundene Aufgabe wird dauerhaft zum Projekt.
 */
export async function ensureProject(name: string): Promise<Task> {
  const key = name.toLowerCase();
  const existing = (await db.tasks.toArray()).find(
    (task) => isLive(task) && task.status !== 'done' && task.title.toLowerCase() === key,
  );
  if (existing === undefined) return createTask({ title: name, status: 'next', pinnedAsProject: true });
  if (!existing.pinnedAsProject) await setProjectPinned(existing.id, true);
  return existing;
}

export async function createContext(name: string, color = 'slate'): Promise<Context> {
  return mutate(async ({ hlc, now, dirty }) => {
    const existingOrders = (await db.contexts.toArray()).filter(isLive).map((c) => c.order).sort();
    const context: Context = {
      id: uuidv7(now),
      name,
      color,
      order: generateKeyBetween(existingOrders.at(-1) ?? null, null),
      deletedAt: null,
      hlc,
    };
    await db.contexts.put(context);
    dirty('context', context.id);
    return context;
  });
}

/** Legt fehlende Kontexte an und liefert die IDs in der Reihenfolge der Namen (Quick Add). */
export async function ensureContexts(names: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const existing = (await db.contexts.toArray()).find(
      (c) => isLive(c) && c.name.toLowerCase() === name.toLowerCase(),
    );
    ids.push(existing?.id ?? (await createContext(name)).id);
  }
  return ids;
}

export async function updateContext(id: string, patch: Partial<Omit<Context, 'id' | 'hlc'>>): Promise<void> {
  await mutate(async ({ hlc, dirty }) => {
    const existing = await db.contexts.get(id);
    if (existing === undefined) return;
    await db.contexts.put({ ...existing, ...patch, id, hlc });
    dirty('context', id);
  });
}

/**
 * Verschiebt einen Kontext zwischen zwei Nachbarn (Einstellungen). Die Reihenfolge gilt
 * überall: Filterleiste, Chips auf der Karte, Board-Spalten und Sortierung nach Kontext.
 */
export async function moveContext(
  id: string,
  target: { afterId?: string | null; beforeId?: string | null },
): Promise<void> {
  const after = target.afterId != null ? await db.contexts.get(target.afterId) : undefined;
  const before = target.beforeId != null ? await db.contexts.get(target.beforeId) : undefined;
  await updateContext(id, { order: generateKeyBetween(after?.order ?? null, before?.order ?? null) });
}

/** Kontext löschen und aus allen Aufgaben entfernen – sonst bleiben unsichtbare Filter zurück. */
export async function deleteContext(id: string): Promise<void> {
  await mutate(async ({ hlc, now, dirty }) => {
    const existing = await db.contexts.get(id);
    if (existing === undefined) return;
    await db.contexts.put({ ...existing, deletedAt: now, hlc });
    dirty('context', id);

    const affected = await db.tasks.where('contexts').equals(id).toArray();
    const cleaned = affected.map((t) => ({ ...t, contexts: t.contexts.filter((c) => c !== id), hlc }));
    await db.tasks.bulkPut(cleaned);
    for (const t of cleaned) dirty('task', t.id);
  });
}

/** Testhilfe: setzt Datenbank und Uhr zurück. */
export async function resetRepo(): Promise<void> {
  clock = null;
  outboxSeq = 0;
  await db.transaction('rw', [db.tasks, db.contexts, db.outbox, db.meta, db.blobs, db.blobQueue], async () => {
    await Promise.all([
      db.tasks.clear(),
      db.contexts.clear(),
      db.outbox.clear(),
      db.meta.clear(),
      db.blobs.clear(),
      db.blobQueue.clear(),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Sync-Anbindung
// ---------------------------------------------------------------------------

export type RecordKind = 'task' | 'context';

export interface PendingRecord {
  kind: RecordKind;
  id: string;
  hlc: string;
  value: Task | Context;
}

/** Was auf den Server soll: die Outbox-Markierungen, aufgelöst zum aktuellen Stand. */
export async function pendingRecords(limit = 200): Promise<PendingRecord[]> {
  const entries = (await db.outbox.toArray()).sort((a, b) => a.seq - b.seq).slice(0, limit);
  const out: PendingRecord[] = [];
  for (const entry of entries) {
    const value =
      entry.kind === 'task' ? await db.tasks.get(entry.recordId) : await db.contexts.get(entry.recordId);
    // Record weg, Markierung übrig: aufräumen statt endlos erneut versuchen.
    if (value === undefined) {
      await db.outbox.delete(entry.recordId);
      continue;
    }
    out.push({ kind: entry.kind, id: entry.recordId, hlc: value.hlc, value });
  }
  return out;
}

/**
 * Nach erfolgreichem Push aufräumen – aber nur, wenn der Record sich seitdem nicht
 * geändert hat. Sonst ginge eine Bearbeitung verloren, die während des Pushs passiert ist.
 */
export async function confirmPushed(pushed: readonly PendingRecord[]): Promise<void> {
  await db.transaction('rw', db.tasks, db.contexts, db.outbox, async () => {
    for (const record of pushed) {
      const current =
        record.kind === 'task' ? await db.tasks.get(record.id) : await db.contexts.get(record.id);
      if (current?.hlc === record.hlc) await db.outbox.delete(record.id);
    }
  });
}

/**
 * Nach einem Restore des Servers (neue Epoche, `private.rotate_sync_epoch`): alles noch einmal
 * hochladen und von vorn holen.
 *
 * Was seit dem Backup auf den Server kam, fehlt dort jetzt, steht aber auf den Geräten – nur
 * nicht mehr in deren Outbox. Deshalb wandert jeder Record wieder hinein, Tombstones
 * eingeschlossen, damit auch Löschungen ankommen. Ältere Stände verwirft der Server am
 * HLC-Vergleich, und der Pull ab 0 bringt, was andere Geräte schon wieder hochgeladen haben.
 * Dasselbe gilt für Anhang-Dateien, soweit sie auf diesem Gerät liegen.
 */
export async function resyncAll(): Promise<void> {
  await initRepo();
  await db.transaction('rw', [db.tasks, db.contexts, db.outbox, db.meta, db.blobs, db.blobQueue], async () => {
    const queued = new Set((await db.outbox.toArray()).map((e) => e.recordId));
    const entries: OutboxEntry[] = [];
    const add = (kind: OutboxEntry['kind'], id: string): void => {
      if (queued.has(id)) return;
      outboxSeq += 1;
      entries.push({ recordId: id, kind, seq: outboxSeq });
    };
    const tasks = await db.tasks.toArray();
    for (const task of tasks) add('task', task.id);
    for (const context of await db.contexts.toArray()) add('context', context.id);
    await db.outbox.bulkPut(entries);

    // Ein offener Löschauftrag bleibt stehen: die Datei soll weg, nicht zurück.
    const local = new Set(await db.blobs.toCollection().primaryKeys());
    const pendingFiles = new Set(await db.blobQueue.toCollection().primaryKeys());
    await db.blobQueue.bulkPut(
      tasks.flatMap((task) =>
        task.attachments
          .filter((a) => local.has(a.id) && !pendingFiles.has(a.id))
          .map((a) => ({ id: a.id, taskId: task.id, op: 'upload' as const })),
      ),
    );

    await db.meta.bulkPut([
      { key: META_KEYS.outboxSeq, value: outboxSeq },
      { key: META_KEYS.pullCursor, value: 0 },
    ]);
  });
}

/**
 * Bindet die lokalen Daten an den Vault, mit dem gerade synchronisiert wird. Liefert, ob
 * dabei Daten eines anderen Vaults verworfen wurden.
 *
 * Pull-Cursor, Epoche und Outbox gelten nur für einen Vault. Ohne diese Bindung liefe nach
 * einem Kontowechsel auf demselben Gerät der Pull beim Cursor des alten Vaults weiter – die
 * älteren Records des neuen kämen nie an – und die Aufgaben des alten Kontos gingen mit der
 * nächsten Bearbeitung in den Vault des neuen.
 *
 * Drei Fälle:
 * - Noch nie gebunden: die Daten sind rein lokal entstanden (oder stammen aus der Zeit vor
 *   dieser Bindung) und gehören zu diesem Vault. Nichts wird verworfen; was noch nicht oben
 *   ist, steht in der Outbox.
 * - Derselbe Vault: nichts zu tun.
 * - Ein anderer Vault: Aufgaben, Kontexte, Dateien, Outbox und Cursor gehören dem alten und
 *   werden verworfen. Auf dem Server und den anderen Geräten des alten Vaults liegen sie
 *   weiterhin; verloren ist nur, was dort noch nicht angekommen war. Der nächste Pull holt
 *   den neuen Vault ab 0.
 */
export async function bindVault(vaultId: string): Promise<boolean> {
  await initRepo();
  let switched = false;
  await db.transaction('rw', [db.tasks, db.contexts, db.outbox, db.meta, db.blobs, db.blobQueue], async () => {
    const bound = (await db.meta.get(META_KEYS.syncVaultId))?.value as string | undefined;
    if (bound === vaultId) return;
    if (bound !== undefined) {
      await Promise.all([
        db.tasks.clear(),
        db.contexts.clear(),
        db.outbox.clear(),
        db.blobs.clear(),
        db.blobQueue.clear(),
        // Filter und eingeklappte Abschnitte verweisen auf Kontext-IDs des alten Vaults.
        db.meta.bulkDelete([META_KEYS.pullCursor, META_KEYS.serverEpoch, META_KEYS.lastSyncAt, ...CONTEXT_ID_SETTINGS]),
      ]);
      outboxSeq = 0;
      await db.meta.put({ key: META_KEYS.outboxSeq, value: outboxSeq });
      switched = true;
    }
    await db.meta.put({ key: META_KEYS.syncVaultId, value: vaultId });
  });
  return switched;
}

export interface RemoteChange {
  kind: RecordKind;
  value: Task | Context;
}

/**
 * Eine fremde Löschung. Sie trägt nur ID, Zeitpunkt und Uhr – den Inhalt hat das löschende
 * Gerät nicht mehr hinausgeschickt. Lokal bleibt der Inhalt als Tombstone erhalten, bis
 * `purgeLocalTombstones` ihn wegräumt.
 */
export async function applyRemoteTombstone(
  kind: RecordKind,
  id: string,
  hlc: string,
  deletedAt: number,
): Promise<boolean> {
  await initRepo();
  let applied = false;

  await db.transaction('rw', db.tasks, db.contexts, db.meta, async () => {
    clock = mergeHlc(requireClock(), hlc, Date.now());

    // Unbekannt ist der Record hier nur, wenn er auf einem anderen Gerät angelegt und
    // gelöscht wurde, bevor dieses ihn sah. Dann gibt es nichts zu löschen.
    const stale = <R extends { hlc: string }>(record: R | undefined): record is R =>
      record !== undefined && isNewer(hlc, record.hlc);
    const tombstoned = <R extends { deletedAt: number | null }>(record: R): R => ({
      ...record,
      deletedAt: record.deletedAt ?? deletedAt,
      hlc,
    });

    if (kind === 'task') {
      const task = await db.tasks.get(id);
      if (stale(task)) await db.tasks.put(tombstoned(task));
      applied = stale(task);
    } else {
      const context = await db.contexts.get(id);
      if (stale(context)) await db.contexts.put(tombstoned(context));
      applied = stale(context);
    }

    await db.meta.put({ key: META_KEYS.clock, value: clock });
  });

  return applied;
}

/**
 * Lokale Tombstones wegwerfen, die ihren Zweck erfüllt haben.
 *
 * Sicher ist das erst, wenn der Record nicht mehr in der Outbox steht: sonst verschwände
 * eine Löschung, bevor irgendein anderes Gerät sie erfahren hat.
 */
export async function purgeLocalTombstones(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  let purged = 0;

  await db.transaction('rw', [db.tasks, db.contexts, db.outbox, db.blobQueue], async () => {
    const isStale = (record: { deletedAt: number | null }): boolean =>
      record.deletedAt !== null && record.deletedAt < cutoff;

    for (const task of (await db.tasks.toArray()).filter(isStale)) {
      if ((await db.outbox.get(task.id)) !== undefined) continue;
      await db.tasks.delete(task.id);
      // Jetzt kann kein Undo die Aufgabe mehr zurückholen – ihre Dateien dürfen vom Server.
      await db.blobQueue.bulkPut(task.attachments.map((a) => ({ id: a.id, taskId: task.id, op: 'delete' as const })));
      purged += 1;
    }
    for (const context of (await db.contexts.toArray()).filter(isStale)) {
      if ((await db.outbox.get(context.id)) !== undefined) continue;
      await db.contexts.delete(context.id);
      purged += 1;
    }
  });

  return purged;
}

/**
 * Fremde Änderungen einspielen. Last-Writer-Wins auf Record-Ebene: gewinnt der fremde
 * Stand, wird er geschrieben – *ohne* Outbox-Eintrag, denn er kommt ja vom Server.
 *
 * Die lokale Uhr zieht dabei nach, damit die eigene nächste Änderung diesen Stand
 * garantiert schlägt – auch wenn die Systemuhr dieses Geräts nachgeht.
 */
export async function applyRemoteChanges(changes: readonly RemoteChange[]): Promise<number> {
  if (changes.length === 0) return 0;
  await initRepo();
  let applied = 0;

  await db.transaction('rw', db.tasks, db.contexts, db.meta, async () => {
    for (const change of changes) {
      // Was hier nicht passt, stammt aus einer kaputten oder fremden Version. Überspringen
      // statt werfen: ein Fehler bräche den Pull ab, und der Sync bliebe für immer daran hängen.
      const value = change.kind === 'task' ? normalizeTask(change.value) : normalizeContext(change.value);
      if (value === null || !isValidHlc(value.hlc)) continue;

      clock = mergeHlc(requireClock(), value.hlc, Date.now());
      const table = change.kind === 'task' ? db.tasks : db.contexts;
      const existing = await table.get(value.id);
      if (existing !== undefined && !isNewer(value.hlc, existing.hlc)) continue;
      await (change.kind === 'task' ? db.tasks.put(value as Task) : db.contexts.put(value as Context));
      applied += 1;
    }
    await db.meta.put({ key: META_KEYS.clock, value: clock });
  });

  return applied;
}

/** Einstellungen, die Kontext-IDs speichern und beim Zusammenführen mitziehen müssen. */
const CONTEXT_ID_SETTINGS = [
  META_KEYS.contextFilter,
  META_KEYS.collapsedContexts,
  META_KEYS.allContextFilter,
  META_KEYS.allCollapsedContexts,
] as const;

const contextKey = (name: string): string => name.trim().toLowerCase();

/**
 * Gleichnamige Kontexte zu einem zusammenführen.
 *
 * Doppelt entstehen sie, wenn zwei Geräte unabhängig voneinander einen Kontext gleichen
 * Namens anlegen – vor allem die Standard-Kontexte, die jedes Gerät beim ersten Start
 * bekommt, bevor es dem Vault beitritt. Überlebender ist der mit der kleinsten ID (bei
 * UUIDv7 der älteste): so entscheiden alle Geräte gleich, ohne sich abzusprechen.
 *
 * Verweise auf einen gelöschten Kontext, zu dem ein gleichnamiger lebender existiert,
 * werden ebenfalls umgebogen. Sonst behielte eine Aufgabe, die ein anderes Gerät vor
 * seiner eigenen Zusammenführung geändert hat, den Verweis auf das Duplikat.
 *
 * Liefert die Zahl der geänderten Records.
 */
export async function mergeDuplicateContexts(): Promise<number> {
  const plan = async (): Promise<{ losers: Context[]; remap: Map<string, string> }> => {
    const contexts = await db.contexts.toArray();
    const survivors = new Map<string, Context>();
    for (const c of contexts.filter(isLive).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!survivors.has(contextKey(c.name))) survivors.set(contextKey(c.name), c);
    }
    const losers: Context[] = [];
    const remap = new Map<string, string>();
    for (const c of contexts) {
      const survivor = survivors.get(contextKey(c.name));
      if (survivor === undefined || survivor.id === c.id) continue;
      if (isLive(c)) losers.push(c);
      remap.set(c.id, survivor.id);
    }
    return { losers, remap };
  };

  const hasWork = async (remap: Map<string, string>, losers: Context[]): Promise<boolean> =>
    losers.length > 0 || (await db.tasks.where('contexts').anyOf([...remap.keys()]).count()) > 0;

  // Vorab nur lesen: ein Durchlauf ohne Duplikate soll weder die Uhr ticken noch schreiben.
  const preview = await plan();
  if (!(await hasWork(preview.remap, preview.losers))) return 0;

  return mutate(async ({ hlc, now, dirty }) => {
    const { losers, remap } = await plan();
    for (const loser of losers) {
      await db.contexts.put({ ...loser, deletedAt: now, hlc });
      dirty('context', loser.id);
    }

    const replace = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => remap.get(id) ?? id))];
    const affected = await db.tasks.where('contexts').anyOf([...remap.keys()]).distinct().toArray();
    for (const task of affected) {
      await db.tasks.put({ ...task, contexts: replace(task.contexts), hlc });
      dirty('task', task.id);
    }

    for (const key of CONTEXT_ID_SETTINGS) {
      const row = await db.meta.get(key);
      if (Array.isArray(row?.value)) await db.meta.put({ key, value: replace(row.value as string[]) });
    }

    return losers.length + affected.length;
  });
}

/** Eine Sicherung, wie sie aus einer Datei kommt – also ungeprüft. */
export interface ImportPayload {
  tasks?: unknown;
  contexts?: unknown;
}

export interface ImportResult {
  tasks: number;
  contexts: number;
}

/**
 * Sicherung einspielen. Anders als beim Sync bekommen importierte Records einen
 * *frischen* lokalen Zeitstempel und landen in der Outbox: ein Backup soll gewinnen
 * und auf die anderen Geräte gelangen, sonst wäre die Wiederherstellung wirkungslos.
 *
 * Tombstones werden mit übernommen – gelöschtes bleibt gelöscht.
 */
export async function importRecords(payload: ImportPayload): Promise<ImportResult> {
  // Jedes Feld wird geprüft: ein kaputter Record ginge sonst über die Outbox an alle Geräte.
  const validTasks = (Array.isArray(payload.tasks) ? payload.tasks : [])
    .map(normalizeTask)
    .filter((t): t is Task => t !== null);
  const validContexts = (Array.isArray(payload.contexts) ? payload.contexts : [])
    .map(normalizeContext)
    .filter((c): c is Context => c !== null);
  if (validTasks.length === 0 && validContexts.length === 0) return { tasks: 0, contexts: 0 };

  const result = await mutate(async ({ hlc, dirty }) => {
    await db.tasks.bulkPut(validTasks.map((t) => ({ ...t, hlc })));
    await db.contexts.bulkPut(validContexts.map((c) => ({ ...c, hlc })));
    for (const t of validTasks) dirty('task', t.id);
    for (const c of validContexts) dirty('context', c.id);

    return { tasks: validTasks.length, contexts: validContexts.length };
  });

  // Die Sicherung bringt ihre Kontexte mit eigenen IDs mit, das Gerät hat beim ersten Start
  // aber schon gleichnamige Standard-Kontexte angelegt. Dieselbe Zusammenführung
  // wie nach einem Sync: der älteste gewinnt, Aufgaben und Filter ziehen mit.
  await mergeDuplicateContexts();
  return result;
}
