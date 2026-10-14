import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getMeta, META_KEYS } from '@/data/db';
import {
  applyRemoteChanges,
  createContext,
  createTask,
  deleteTask,
  initRepo,
  pendingRecords,
  purgeLocalTombstones,
  resetRepo,
  updateTask,
} from '@/data/repo';
import { createVault } from '@/crypto/keyring';
import { open, seal } from '@/crypto/envelope';
import { MemorySyncAdapter } from '@/sync/memory';
import { SyncEngine } from '@/sync/engine';
import type { RemoteRecord } from '@/sync/adapter';
import { formatHlc } from '@/domain/hlc';
import type { Context, Task } from '@/domain/types';

/**
 * Das zweite Gerät wird hier direkt über die Krypto- und Protokollschicht nachgebildet.
 * Es benutzt denselben Vault-Schlüssel und dasselbe HLC-Format wie ein echter Client –
 * getestet wird also die Zusammenführungslogik, nicht eine Attrappe davon.
 */

let vaultKey: CryptoKey;
let adapter: MemorySyncAdapter;
let engine: SyncEngine;

const KEY_VERSION = 1;
const VAULT_ID = 'vault-a';
const hlcOf = (millis: number, device = 'bbbb'): string => formatHlc({ millis, counter: 0, deviceId: device });

const fromDeviceB = async (id: string, hlc: string, value: Partial<Task>): Promise<RemoteRecord> => {
  const task: Task = {
    id,
    title: 'von Gerät B',
    notes: '',
    status: 'next',
    parentId: null,
    order: 'a0',
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
    createdAt: 1,
    deletedAt: null,
    ...value,
    hlc,
  };
  const envelope = await seal(vaultKey, id, KEY_VERSION, { kind: 'task', value: task });
  return { id, hlc, ...envelope, deleted: value.deletedAt != null, serverSeq: null };
};

const readPayloadFromServer = async (
  id: string,
): Promise<{ kind: string; value?: Task; tombstone?: { deletedAt: number; hlc: string } }> => {
  const record = (await adapter.pull(0, 100)).records.find((r) => r.id === id);
  if (record === undefined) throw new Error(`Record ${id} liegt nicht auf dem Server.`);
  return open(vaultKey, id, record);
};

const readFromServer = async (id: string): Promise<Task> => {
  const page = await adapter.pull(0, 100);
  const record = page.records.find((r) => r.id === id);
  if (record === undefined) throw new Error(`Record ${id} liegt nicht auf dem Server.`);
  const payload = await open<{ value: Task }>(vaultKey, id, record);
  return payload.value;
};

beforeEach(async () => {
  await resetRepo();
  await initRepo();
  ({ vaultKey } = await createVault('test-passphrase'));
  adapter = new MemorySyncAdapter();
  engine = new SyncEngine(adapter, { key: () => vaultKey, keyVersion: () => KEY_VERSION, vaultId: () => VAULT_ID });
});

describe('Push', () => {
  it('schiebt lokale Änderungen verschlüsselt zum Server und leert die Outbox', async () => {
    const task = await createTask({ title: 'Geheime Aufgabe', status: 'next' });

    const result = await engine.syncOnce();
    expect(result.pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    expect((await readFromServer(task.id)).title).toBe('Geheime Aufgabe');
  });

  it('legt beim Server nichts im Klartext ab', async () => {
    await createTask({ title: 'Sehr vertraulich', status: 'next' });
    await engine.syncOnce();

    const raw = JSON.stringify((await adapter.pull(0, 10)).records);
    expect(raw).not.toContain('Sehr vertraulich');
    expect(raw).not.toContain('title');
  });

  it('holt nach, was während einer Offline-Phase aufgelaufen ist', async () => {
    for (let i = 0; i < 5; i++) await createTask({ title: `Aufgabe ${i}`, status: 'next' });
    expect(await db.outbox.count()).toBe(5);

    expect((await engine.syncOnce()).pushed).toBe(5);
    expect(await db.outbox.count()).toBe(0);
  });

  it('behält die Markierung, wenn ein Record sich während des Pushs ändert', async () => {
    const task = await createTask({ title: 'Erst so', status: 'next' });
    const pending = await pendingRecords();
    await updateTask(task.id, { title: 'Dann anders' });

    // Bestätigt wird der alte Stand – die zwischenzeitliche Änderung darf nicht verfallen.
    const { confirmPushed } = await import('@/data/repo');
    await confirmPushed(pending);
    expect(await db.outbox.count()).toBe(1);
  });
});

describe('Pull und Zusammenführen', () => {
  it('übernimmt eine fremde Aufgabe', async () => {
    await adapter.push([await fromDeviceB('remote-1', hlcOf(9_000_000_000_000), { title: 'Von drüben' })]);

    expect((await engine.syncOnce()).pulled).toBe(1);
    expect((await db.tasks.get('remote-1'))?.title).toBe('Von drüben');
  });

  it('ergänzt die Priorität bei Records von Geräten mit älterer App-Version', async () => {
    await adapter.push([
      await fromDeviceB('remote-alt', hlcOf(9_000_000_000_000), {
        highPriority: undefined as unknown as boolean,
        attachments: undefined as unknown as [],
      }),
    ]);

    await engine.syncOnce();
    expect((await db.tasks.get('remote-alt'))?.highPriority).toBe(false);
    expect((await db.tasks.get('remote-alt'))?.attachments).toEqual([]);
  });

  it('überspringt unbrauchbare fremde Records, statt am Sync hängen zu bleiben', async () => {
    const broken = async (id: string, value: unknown): Promise<RemoteRecord> => {
      const hlc = hlcOf(9_000_000_000_000);
      return { id, hlc, ...(await seal(vaultKey, id, KEY_VERSION, { kind: 'task', value })), deleted: false, serverSeq: null };
    };
    await adapter.push([
      await broken('ohne-titel', { id: 'ohne-titel', hlc: hlcOf(9_000_000_000_000) }),
      await broken('ohne-hlc', { id: 'ohne-hlc', title: 'Keine Uhr' }),
      await fromDeviceB('heil', hlcOf(9_000_000_000_000), { title: 'Heil', contexts: 'büro' as unknown as string[] }),
    ]);

    const result = await engine.syncOnce();

    expect(result.pulled).toBe(1);
    expect(await db.tasks.get('ohne-titel')).toBeUndefined();
    expect(await db.tasks.get('ohne-hlc')).toBeUndefined();
    expect((await db.tasks.get('heil'))?.contexts).toEqual([]);
    expect((await engine.syncOnce()).pulled).toBe(0);
  });

  it('lässt einen älteren fremden Stand nicht gewinnen', async () => {
    const task = await createTask({ title: 'Lokal neu', status: 'next' });
    await adapter.push([await fromDeviceB(task.id, hlcOf(1), { title: 'Alt und überholt' })]);

    await engine.syncOnce();
    expect((await db.tasks.get(task.id))?.title).toBe('Lokal neu');
  });

  it('lässt einen neueren fremden Stand gewinnen', async () => {
    const task = await createTask({ title: 'Lokal', status: 'next' });
    await adapter.push([await fromDeviceB(task.id, hlcOf(9_000_000_000_000), { title: 'Neuer von B' })]);

    await engine.syncOnce();
    expect((await db.tasks.get(task.id))?.title).toBe('Neuer von B');
  });

  it('überträgt eine fremde Löschung als Tombstone', async () => {
    const task = await createTask({ title: 'Wird gelöscht', status: 'next' });
    await adapter.push([
      await fromDeviceB(task.id, hlcOf(9_000_000_000_000), { title: 'Wird gelöscht', deletedAt: 123 }),
    ]);

    await engine.syncOnce();
    expect((await db.tasks.get(task.id))?.deletedAt).toBe(123);
  });

  it('zieht die lokale Uhr nach, damit die nächste eigene Änderung gewinnt', async () => {
    const task = await createTask({ title: 'Lokal', status: 'next' });
    // Gerät B hat eine weit vorlaufende Uhr.
    await adapter.push([await fromDeviceB(task.id, hlcOf(9_000_000_000_000), { title: 'Von B' })]);
    await engine.syncOnce();

    await updateTask(task.id, { title: 'Danach lokal' });
    await engine.syncOnce();

    expect((await db.tasks.get(task.id))?.title).toBe('Danach lokal');
    expect((await readFromServer(task.id)).title).toBe('Danach lokal');
  });

  it('stempelt eine Änderung neuer als einen gleichzeitig eingespielten fremden Stand', async () => {
    const task = await createTask({ title: 'Lokal', status: 'next' });
    const remoteHlc = hlcOf(9_000_000_000_000);
    const remote = { kind: 'task' as const, value: { ...task, title: 'Von B', hlc: remoteHlc } };

    // Pull und Bearbeitung laufen gleichzeitig: die Uhr darf erst in der Transaktion ticken,
    // sonst bekäme die Bearbeitung einen älteren Zeitstempel als der Stand, auf dem sie aufsetzt.
    await Promise.all([applyRemoteChanges([remote]), updateTask(task.id, { notes: 'währenddessen' })]);

    const stored = await db.tasks.get(task.id);
    expect(stored?.notes).toBe('währenddessen');
    expect(stored!.hlc > remoteHlc).toBe(true);
  });

  it('konvergiert, wenn beide Seiten offline dieselbe Aufgabe geändert haben', async () => {
    const task = await createTask({ title: 'Anfang', status: 'next' });
    await engine.syncOnce();

    // Beide ändern, ohne voneinander zu wissen; B ist später dran.
    await updateTask(task.id, { title: 'Lokale Änderung' });
    const local = await db.tasks.get(task.id);
    await adapter.push([
      await fromDeviceB(task.id, hlcOf(9_000_000_000_000), { ...local, title: 'Änderung von B' }),
    ]);

    await engine.syncOnce();
    await engine.syncOnce();

    // Beide Seiten sehen denselben Stand – und zwar den neueren.
    expect((await db.tasks.get(task.id))?.title).toBe('Änderung von B');
    expect((await readFromServer(task.id)).title).toBe('Änderung von B');
    expect(await db.outbox.count()).toBe(0);
  });

  it('bleibt unabhängig davon, in welcher Reihenfolge die Änderungen eintreffen', async () => {
    const neu = await fromDeviceB('x', hlcOf(9_000_000_000_000), { title: 'Neu' });
    const alt = await fromDeviceB('x', hlcOf(2), { title: 'Alt' });

    await adapter.push([neu, alt]);
    await engine.syncOnce();
    expect((await db.tasks.get('x'))?.title).toBe('Neu');
  });

  it('bleibt an einem unlesbaren Record nicht hängen', async () => {
    const foreign = await createVault('anderer-vault');
    const envelope = await seal(foreign.vaultKey, 'fremd', KEY_VERSION, { kind: 'task', value: {} });
    await adapter.push([{ id: 'fremd', hlc: hlcOf(5_000_000_000_000), ...envelope, deleted: false, serverSeq: null }]);
    await adapter.push([await fromDeviceB('lesbar', hlcOf(6_000_000_000_000), { title: 'Geht doch' })]);

    const result = await engine.syncOnce();
    expect(result.undecryptable).toBe(1);
    expect(result.pulled).toBe(1);
    // Der Cursor ist weitergelaufen – ein zweiter Durchlauf holt nichts Neues mehr.
    expect(await getMeta<number>(META_KEYS.pullCursor)).toBeGreaterThan(0);
    expect((await engine.syncOnce()).pulled).toBe(0);
  });

  it('spielt eine gelöschte Aufgabe nicht als lebend zurück', async () => {
    const task = await createTask({ title: 'Weg damit', status: 'next' });
    await engine.syncOnce();
    await deleteTask(task.id);
    await engine.syncOnce();

    expect((await readPayloadFromServer(task.id)).tombstone).toBeDefined();
    await engine.syncOnce();
    expect((await db.tasks.get(task.id))?.deletedAt).not.toBeNull();
  });
});

describe('Abo-Sperre', () => {
  it('lässt den Pull weiterlaufen, wenn der Push gesperrt ist', async () => {
    // Fremde Änderung liegt bereit, eigene Änderung wartet in der Outbox.
    await adapter.push([await fromDeviceB('remote-1', hlcOf(9_000_000_000_000), { title: 'Von drüben' })]);
    await createTask({ title: 'Lokal erfasst', status: 'next' });
    adapter.blockPush = true;

    const result = await engine.syncOnce();

    expect(result.pushBlocked).toBe(true);
    expect(result.pushed).toBe(0);
    // Das ist der Kern: wer nicht mehr zahlt, kommt weiterhin an die eigenen Daten.
    expect(result.pulled).toBe(1);
    expect((await db.tasks.get('remote-1'))?.title).toBe('Von drüben');
  });

  it('behält die Outbox und schiebt nach der Freischaltung alles nach', async () => {
    adapter.blockPush = true;
    const a = await createTask({ title: 'Eins', status: 'next' });
    const b = await createTask({ title: 'Zwei', status: 'next' });

    await engine.syncOnce();
    await engine.syncOnce();
    // Nichts darf verlorengehen, solange nicht gezahlt wird.
    expect(await db.outbox.count()).toBe(2);

    adapter.blockPush = false;
    const result = await engine.syncOnce();

    expect(result.pushBlocked).toBe(false);
    expect(result.pushed).toBe(2);
    expect(await db.outbox.count()).toBe(0);
    expect((await readFromServer(a.id)).title).toBe('Eins');
    expect((await readFromServer(b.id)).title).toBe('Zwei');
  });

  it('verwechselt einen Netzwerkfehler nicht mit der Abo-Sperre', async () => {
    await createTask({ title: 'Egal', status: 'next' });
    adapter.push = () => Promise.reject(new Error('network down'));

    // Ein echter Fehler muss durchschlagen, sonst sähe der Nutzer eine Kaufaufforderung,
    // obwohl nur das Netz weg ist.
    await expect(engine.syncOnce()).rejects.toThrow('network down');
    expect(await db.outbox.count()).toBe(1);
  });

  it('meldet Fehler aus dem Hintergrundlauf, statt sie zu verschlucken', async () => {
    // `start()` hängt an Browser-Ereignissen. Statt den Produktionscode dafür
    // aufzuweichen, bekommt der Test die beiden Globals gestellt.
    const noop = { addEventListener: () => undefined, removeEventListener: () => undefined };
    vi.stubGlobal('window', noop);
    vi.stubGlobal('document', { ...noop, visibilityState: 'visible' });
    try {
      await createTask({ title: 'Egal', status: 'next' });
      adapter.push = () => Promise.reject(new Error('network down'));

      const errors: unknown[] = [];
      const stop = engine.start(undefined, (error) => errors.push(error));
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      stop();

      expect((errors[0] as Error).message).toBe('network down');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Anlässe zum Synchronisieren', () => {
  it('holt eine Änderung nach, die während eines Laufs gemeldet wurde', async () => {
    const pull = adapter.pull.bind(adapter);
    let first = true;
    adapter.pull = async (cursor, limit) => {
      const page = await pull(cursor, limit);
      if (first) {
        first = false;
        // Trifft ein, nachdem dieser Pull gelesen hat – wie ein Realtime-Signal mitten im Lauf.
        await adapter.push([await fromDeviceB('spät', hlcOf(9_000_000_000_000), { title: 'Kam spät' })]);
        void engine.syncOnce();
      }
      return page;
    };

    const result = await engine.syncOnce();

    expect(result.pulled).toBe(1);
    expect((await db.tasks.get('spät'))?.title).toBe('Kam spät');
  });

  it('schiebt eine lokale Änderung ohne weiteren Anlass hinaus', async () => {
    const noop = { addEventListener: () => undefined, removeEventListener: () => undefined };
    vi.stubGlobal('window', noop);
    vi.stubGlobal('document', { ...noop, visibilityState: 'visible' });
    try {
      const stop = engine.start();
      await vi.waitFor(() => expect(engine['running']).toBeNull());

      const task = await createTask({ title: 'Gerade erfasst', status: 'next' });
      await vi.waitFor(async () => expect((await readFromServer(task.id)).title).toBe('Gerade erfasst'), {
        timeout: 5000,
      });
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Tombstones', () => {
  it('markiert gelöschte Records für den Server, ohne den Inhalt preiszugeben', async () => {
    const task = await createTask({ title: 'Streng geheim', status: 'next' });
    await engine.syncOnce();
    await deleteTask(task.id);
    await engine.syncOnce();

    const record = (await adapter.pull(0, 100)).records.find((r) => r.id === task.id);
    expect(record?.deleted).toBe(true);
    // Die Markierung ist Klartext, der Titel bleibt es nicht.
    expect(JSON.stringify(record)).not.toContain('Streng geheim');
  });

  it('schickt beim Löschen keinen Inhalt mehr hinaus, nur Zeitpunkt und Uhr', async () => {
    const task = await createTask({ title: 'Wird gelöscht', status: 'next' });
    await engine.syncOnce();
    await deleteTask(task.id);
    await engine.syncOnce();

    const payload = await readPayloadFromServer(task.id);
    expect(payload.value).toBeUndefined();
    expect(payload.kind).toBe('task');
    expect(payload.tombstone).toEqual({ deletedAt: (await db.tasks.get(task.id))?.deletedAt, hlc: expect.any(String) });
  });

  it('wendet eine schlanke Löschung eines anderen Geräts an', async () => {
    const task = await createTask({ title: 'Lebt noch', status: 'next' });
    await engine.syncOnce();

    const hlc = hlcOf(9_000_000_000_000);
    const envelope = await seal(vaultKey, task.id, KEY_VERSION, { kind: 'task', tombstone: { deletedAt: 4711, hlc } });
    await adapter.push([{ id: task.id, hlc, ...envelope, deleted: true, serverSeq: null }]);

    expect((await engine.syncOnce()).pulled).toBe(1);
    const stored = await db.tasks.get(task.id);
    expect(stored?.deletedAt).toBe(4711);
    // Der Inhalt bleibt lokal erhalten, bis der Tombstone aufgeräumt wird.
    expect(stored?.title).toBe('Lebt noch');
  });

  it('glaubt dem Server keine Löschung ohne Ciphertext', async () => {
    const task = await createTask({ title: 'Soll bleiben', status: 'next' });
    await engine.syncOnce();

    // Ein Server, der eine Aufgabe verschwinden lassen will: Klartext-Uhr hoch, Inhalt leer.
    await adapter.push([
      { id: task.id, hlc: hlcOf(9_000_000_000_000), iv: '', ct: '', keyVersion: 1, deleted: true, serverSeq: null },
    ]);

    const result = await engine.syncOnce();
    expect(result.undecryptable).toBe(1);
    expect((await db.tasks.get(task.id))?.deletedAt).toBeNull();
  });

  it('räumt lokale Tombstones auf, aber niemals ungesendete', async () => {
    const gesendet = await createTask({ title: 'Alt und gesendet', status: 'next' });
    const ungesendet = await createTask({ title: 'Alt und ungesendet', status: 'next' });
    await deleteTask(gesendet.id);
    await engine.syncOnce(); // leert die Outbox für den ersten
    await deleteTask(ungesendet.id);

    // Beide Löschungen weit in die Vergangenheit datieren.
    const alt = Date.now() - 200 * 24 * 60 * 60 * 1000;
    await db.tasks.update(gesendet.id, { deletedAt: alt });
    await db.tasks.update(ungesendet.id, { deletedAt: alt });

    const purged = await purgeLocalTombstones(90 * 24 * 60 * 60 * 1000);

    expect(purged).toBe(1);
    expect(await db.tasks.get(gesendet.id)).toBeUndefined();
    // Noch nicht gesendet: die Löschung kennt sonst niemand, sie darf nicht verschwinden.
    expect(await db.tasks.get(ungesendet.id)).toBeDefined();
  });
});

describe('Doppelte Kontexte', () => {
  const contextFromDeviceB = async (id: string, name: string, millis: number): Promise<RemoteRecord> => {
    const hlc = hlcOf(millis);
    const context: Context = { id, name, color: 'slate', order: 'a0', deletedAt: null, hlc };
    const envelope = await seal(vaultKey, id, KEY_VERSION, { kind: 'context', value: context });
    return { id, hlc, ...envelope, deleted: false, serverSeq: null };
  };

  // Gerät B hat seine Standard-Kontexte früher angelegt: seine IDs sind kleiner.
  const OLDER_ID = '00000000-0000-7000-8000-000000000001';

  it('führt gleichnamige Kontexte beider Geräte zu einem zusammen', async () => {
    const local = await createContext('büro');
    await adapter.push([await contextFromDeviceB(OLDER_ID, 'Büro', 1)]);

    await engine.syncOnce();

    const live = (await db.contexts.toArray()).filter((c) => c.deletedAt === null);
    expect(live.map((c) => c.id)).toEqual([OLDER_ID]);
    expect((await db.contexts.get(local.id))?.deletedAt).not.toBeNull();
    // Die Löschung des Duplikats geht im selben Lauf hinaus.
    expect((await pendingRecords(10)).length).toBe(0);
    expect((await adapter.pull(0, 100)).records.find((r) => r.id === local.id)?.deleted).toBe(true);
  });

  it('biegt Aufgaben und gespeicherte Filter auf den verbleibenden Kontext um', async () => {
    const local = await createContext('büro');
    const task = await createTask({ title: 'Ablage', status: 'next', contexts: [local.id] });
    await db.meta.put({ key: META_KEYS.contextFilter, value: [local.id] });
    await adapter.push([await contextFromDeviceB(OLDER_ID, 'büro', 1)]);

    await engine.syncOnce();

    expect((await db.tasks.get(task.id))?.contexts).toEqual([OLDER_ID]);
    expect(await getMeta(META_KEYS.contextFilter)).toEqual([OLDER_ID]);
  });

  it('korrigiert eine fremde Aufgabe, die noch auf das Duplikat verweist', async () => {
    const local = await createContext('büro');
    await adapter.push([await contextFromDeviceB(OLDER_ID, 'büro', 1)]);
    await engine.syncOnce();

    // Gerät B hat vor seiner eigenen Zusammenführung eine Aufgabe mit dem Duplikat getaggt.
    await adapter.push([await fromDeviceB('t-b', hlcOf(Date.now() + 1000), { contexts: [local.id] })]);
    await engine.syncOnce();

    expect((await db.tasks.get('t-b'))?.contexts).toEqual([OLDER_ID]);
  });

  it('lässt verschiedene Kontexte und einen ruhigen Lauf unangetastet', async () => {
    await createContext('büro');
    await createContext('telefon');
    await engine.syncOnce();
    const before = await getMeta(META_KEYS.clock);

    await engine.syncOnce();

    expect((await db.contexts.toArray()).filter((c) => c.deletedAt === null)).toHaveLength(2);
    expect(await getMeta(META_KEYS.clock)).toEqual(before);
  });
});

describe('Restore des Servers', () => {
  it('lädt nach einer neuen Epoche alles neu hoch und holt ab 0', async () => {
    const alt = await createTask({ title: 'Vor dem Backup', status: 'next' });
    await engine.syncOnce();
    const backup = adapter.backup();

    // Nach dem Backup: eine neue Aufgabe, eine Änderung, eine Löschung.
    const neu = await createTask({ title: 'Nach dem Backup', status: 'next' });
    await updateTask(alt.id, { title: 'Geändert nach dem Backup' });
    const weg = await createTask({ title: 'Gelöscht nach dem Backup', status: 'next' });
    await engine.syncOnce();
    await deleteTask(weg.id);
    await engine.syncOnce();

    adapter.restore(backup);
    // Ein anderes Gerät schreibt nach dem Restore. Seine server_seq liegt unter dem Cursor
    // dieses Geräts – ohne Zurücksetzen käme sie hier nie an.
    await adapter.push([await fromDeviceB('von-b', hlcOf(9_000_000_000_000), { title: 'Nach dem Restore' })]);

    const result = await engine.syncOnce();

    expect(result.pushed).toBe(3);
    expect((await readFromServer(neu.id)).title).toBe('Nach dem Backup');
    expect((await readFromServer(alt.id)).title).toBe('Geändert nach dem Backup');
    expect((await readPayloadFromServer(weg.id)).tombstone).toBeDefined();
    expect((await db.tasks.get('von-b'))?.title).toBe('Nach dem Restore');
    expect(await db.outbox.count()).toBe(0);
  });

  it('lädt bei gleicher Epoche nichts erneut hoch', async () => {
    await createTask({ title: 'Einmal', status: 'next' });
    expect((await engine.syncOnce()).pushed).toBe(1);
    expect((await engine.syncOnce()).pushed).toBe(0);
    expect(await getMeta<string>(META_KEYS.serverEpoch)).toBe(await adapter.epoch());
  });

  it('übernimmt die Epoche beim ersten Lauf, ohne alles neu hochzuladen', async () => {
    await createTask({ title: 'Schon oben', status: 'next' });
    await engine.syncOnce();
    // Gerät aus der Zeit vor der Server-Epoche: Cursor da, Epoche unbekannt.
    await db.meta.delete(META_KEYS.serverEpoch);

    expect((await engine.syncOnce()).pushed).toBe(0);
    expect(await getMeta<string>(META_KEYS.serverEpoch)).toBe(await adapter.epoch());
  });
});

describe('Vault-Wechsel', () => {
  const asVault = (vaultId: string, remote: MemorySyncAdapter): SyncEngine =>
    new SyncEngine(remote, { key: () => vaultKey, keyVersion: () => KEY_VERSION, vaultId: () => vaultId });

  it('bindet rein lokale Daten an den ersten Vault und schiebt sie hinaus', async () => {
    const task = await createTask({ title: 'Vor dem Beitritt', status: 'next' });

    expect((await engine.syncOnce()).pushed).toBe(1);
    expect(await getMeta<string>(META_KEYS.syncVaultId)).toBe(VAULT_ID);
    expect((await readFromServer(task.id)).title).toBe('Vor dem Beitritt');
  });

  it('holt nach einem Wechsel den neuen Vault ab 0 statt beim Cursor des alten', async () => {
    const context = await createContext('Altes Konto');
    await createTask({ title: 'A1', status: 'next' });
    await createTask({ title: 'A2', status: 'next' });
    await createTask({ title: 'A3', status: 'next' });
    await engine.syncOnce();
    await db.meta.put({ key: META_KEYS.contextFilter, value: [context.id] });
    expect(await getMeta<number>(META_KEYS.pullCursor)).toBeGreaterThan(1);

    // Der neue Vault hat genau einen Record, dessen server_seq unter dem alten Cursor liegt.
    const other = new MemorySyncAdapter();
    await other.push([await fromDeviceB('von-b', hlcOf(1_000), { title: 'In Vault B' })]);

    const result = await asVault('vault-b', other).syncOnce();

    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(1);
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(['In Vault B']);
    expect(await db.contexts.count()).toBe(0);
    expect(await getMeta<string>(META_KEYS.syncVaultId)).toBe('vault-b');
    expect(await getMeta(META_KEYS.contextFilter)).toBeUndefined();
    // Nichts vom alten Konto ist im neuen Vault gelandet.
    expect((await other.pull(0, 100)).records).toHaveLength(1);
  });

  it('schiebt offene Änderungen des alten Vaults nicht in den neuen', async () => {
    const task = await createTask({ title: 'Nur in A', status: 'next' });
    await engine.syncOnce();
    await updateTask(task.id, { title: 'Nie hochgeladen' });
    expect(await db.outbox.count()).toBe(1);

    const other = new MemorySyncAdapter();
    await asVault('vault-b', other).syncOnce();

    expect((await other.pull(0, 100)).records).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
    // Der alte Vault behält seinen letzten hochgeladenen Stand.
    expect((await readFromServer(task.id)).title).toBe('Nur in A');
  });

  it('behält Cursor und Daten eines Geräts, das vor der Bindung schon synchronisiert hat', async () => {
    await createTask({ title: 'Alt', status: 'next' });
    await engine.syncOnce();
    const cursor = await getMeta<number>(META_KEYS.pullCursor);
    // Gerät aus der Zeit vor `syncVaultId`: Cursor da, Bindung unbekannt.
    await db.meta.delete(META_KEYS.syncVaultId);

    const result = await engine.syncOnce();

    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
    expect(await getMeta<number>(META_KEYS.pullCursor)).toBe(cursor);
    expect(await db.tasks.count()).toBe(1);
    expect(await getMeta<string>(META_KEYS.syncVaultId)).toBe(VAULT_ID);
  });
});
