import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../mcp/src/server';
import { TaskApi } from '../../mcp/src/taskApi';
import { db } from '@/data/db';
import { initRepo, resetRepo } from '@/data/repo';
import { open, seal } from '@/crypto/envelope';
import {
  authHash,
  formatApiToken,
  generateApiToken,
  parseApiToken,
  unwrapVaultKeyWithToken,
  wrapVaultKeyForToken,
} from '@/crypto/apiToken';
import { randomBytes } from '@/crypto/bytes';
import { formatHlc } from '@/domain/hlc';
import type { Task } from '@/domain/types';
import { MemorySyncAdapter } from '@/sync/memory';
import { SyncEngine } from '@/sync/engine';
import type { PublicTask } from '../../mcp/src/taskApi';

/**
 * Der MCP-Server über einen echten MCP-Client, gegen den Sync-Adapter im Speicher. Ein
 * zweites Gerät wird wie in `sync.test.ts` direkt über die Krypto-Schicht nachgebildet.
 */

const KEY_VERSION = 1;
const VAULT_ID = 'vault-a';

let vaultKey: CryptoKey;
let adapter: MemorySyncAdapter;
let engine: SyncEngine;

const newKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

async function connect(options: { writable?: boolean; onlyTag?: string } = {}): Promise<{ client: Client; api: TaskApi }> {
  const api = new TaskApi(options.onlyTag ?? null);
  const sync = async (): Promise<void> => {
    await engine.syncOnce();
    await api.trackChanges();
  };
  await sync();
  const server = createServer(api, { writable: options.writable ?? true, version: 'test' }, { beforeRead: sync, afterWrite: sync });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, api };
}

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(JSON.stringify(result.content));
  return result.structuredContent as T;
}

/** Eine Änderung von Gerät B, direkt auf dem Server. */
async function fromDeviceB(id: string, millis: number, value: Partial<Task>): Promise<void> {
  const hlc = formatHlc({ millis, counter: 0, deviceId: 'bbbb' });
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
  await adapter.push([{ id, hlc, ...envelope, deleted: false, serverSeq: null }]);
}

beforeEach(async () => {
  await resetRepo();
  await initRepo();
  vaultKey = await newKey();
  adapter = new MemorySyncAdapter();
  engine = new SyncEngine(adapter, { key: () => vaultKey, keyVersion: () => KEY_VERSION, vaultId: () => VAULT_ID });
});

describe('API-Token', () => {
  it('übersteht Formatieren und Parsen', () => {
    const token = generateApiToken();
    expect(parseApiToken(formatApiToken(token))).toEqual(token);
    expect(parseApiToken(`  ${formatApiToken(token)}\n`)).toEqual(token);
  });

  it('lehnt Abgeschnittenes und Fremdes ab', () => {
    const text = formatApiToken(generateApiToken());
    expect(parseApiToken(text.slice(0, -1))).toBeNull();
    expect(parseApiToken(text.replace('tp1.', 'tp2.'))).toBeNull();
    expect(parseApiToken('sk-irgendwas')).toBeNull();
  });

  it('hasht das Auth-Geheimnis so wie die Datenbank (SHA-256, hex)', async () => {
    expect(await authHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('packt den Vault-Key nur mit dem richtigen Schlüsselgeheimnis aus', async () => {
    const raw = randomBytes(32);
    const token = generateApiToken();
    const wrapped = await wrapVaultKeyForToken(raw, token);

    const key = await unwrapVaultKeyWithToken(wrapped, token);
    const original = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const sealed = await seal(original, 'r1', 1, { titel: 'Milch' });
    await expect(open(key, 'r1', sealed)).resolves.toEqual({ titel: 'Milch' });

    const other = { ...token, keySecret: generateApiToken().keySecret };
    await expect(unwrapVaultKeyWithToken(wrapped, other)).rejects.toThrow();
    // Das Auth-Geheimnis, das der Server kennt, öffnet den Schlüssel nicht.
    await expect(unwrapVaultKeyWithToken(wrapped, { ...token, keySecret: token.authSecret })).rejects.toThrow();
  });
});

describe('MCP-Server', () => {
  it('erfasst in Quick-Add-Syntax und schiebt die Aufgabe verschlüsselt hinaus', async () => {
    const { client } = await connect();
    const { task } = await call<{ task: PublicTask }>(client, 'add_task', {
      text: 'Bob anrufen @telefon +Umzug #privat !!',
      notes: 'wegen Kartons',
    });

    expect(task).toMatchObject({
      title: 'Bob anrufen',
      contexts: ['telefon'],
      tags: ['privat'],
      highPriority: true,
      notes: 'wegen Kartons',
      parent: { title: 'Umzug' },
    });
    expect(await db.outbox.count()).toBe(0);
    const raw = JSON.stringify((await adapter.pull(0, 100)).records);
    expect(raw).not.toContain('Bob anrufen');
  });

  it('filtert nach Tag, Kontext, Projekt und Handlungsbereitschaft', async () => {
    const { client } = await connect();
    await call(client, 'add_task', { text: 'Steuer machen #steuer @büro' });
    await call(client, 'add_task', { text: 'Belege sammeln +Steuererklärung' });
    await call(client, 'add_task', { text: 'Irgendwas' });

    const byTag = await call<{ tasks: PublicTask[] }>(client, 'list_tasks', { tag: '#steuer' });
    expect(byTag.tasks.map((t) => t.title)).toEqual(['Steuer machen']);

    const byContext = await call<{ tasks: PublicTask[] }>(client, 'list_tasks', { context: '@Büro' });
    expect(byContext.tasks.map((t) => t.title)).toEqual(['Steuer machen']);

    const byProject = await call<{ tasks: PublicTask[] }>(client, 'list_tasks', { project: 'steuererklärung' });
    expect(byProject.tasks.map((t) => t.title)).toEqual(['Belege sammeln']);

    // Das Projekt selbst ist keine Aktion; die Inbox-Aufgabe ohne Kontext auch nicht.
    const actionable = await call<{ tasks: PublicTask[] }>(client, 'list_tasks', { view: 'actionable' });
    expect(actionable.tasks.map((t) => t.title).sort()).toEqual(['Belege sammeln', 'Steuer machen']);

    const { projects } = await call<{ projects: (PublicTask & { openSteps: number })[] }>(client, 'list_projects');
    expect(projects).toMatchObject([{ title: 'Steuererklärung', openSteps: 1 }]);
  });

  it('ändert Felder, Tags und Projekt und erledigt', async () => {
    const { client } = await connect();
    const { task } = await call<{ task: PublicTask }>(client, 'add_task', { text: 'Bericht #arbeit #entwurf' });

    const { task: updated } = await call<{ task: PublicTask }>(client, 'update_task', {
      id: task.id,
      dueDate: '2030-01-15',
      addTags: ['wichtig'],
      removeTags: ['#entwurf'],
      contexts: ['@laptop'],
      project: 'Quartal',
    });
    expect(updated).toMatchObject({
      dueDate: '2030-01-15',
      tags: ['arbeit', 'wichtig'],
      contexts: ['laptop'],
      parent: { title: 'Quartal' },
    });

    const { task: done } = await call<{ task: PublicTask }>(client, 'complete_task', { id: task.id });
    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();
    // Beim Erledigen fällt die Fälligkeit weg, wie in der App.
    expect(done.dueDate).toBeNull();
  });

  it('meldet unbekannte IDs als Fehler statt still nichts zu tun', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'complete_task', arguments: { id: 'gibt-es-nicht' } });
    expect(result.isError).toBe(true);
  });

  it('zeigt einem Lese-Token keine schreibenden Werkzeuge', async () => {
    const { client } = await connect({ writable: false });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_tasks');
    expect(names).not.toContain('add_task');
    expect(names).not.toContain('delete_task');
  });

  it('liefert Änderungen anderer Geräte über changes_since – auch mit älterem Zeitstempel', async () => {
    const { client } = await connect();
    await call(client, 'add_task', { text: 'Erste' });
    const first = await call<{ tasks: PublicTask[]; cursor: string; reset: boolean }>(client, 'changes_since');
    expect(first.reset).toBe(true);
    expect(first.tasks.map((t) => t.title)).toEqual(['Erste']);

    // Gerät B war offline: seine Uhr steht vor allem, was dieser Server schon gesehen hat.
    await fromDeviceB('0190f000-0000-7000-8000-00000000000b', 1000, { title: 'Offline erfasst' });

    const next = await call<{ tasks: PublicTask[]; cursor: string; reset: boolean }>(client, 'changes_since', {
      cursor: first.cursor,
    });
    expect(next.reset).toBe(false);
    expect(next.tasks.map((t) => t.title)).toEqual(['Offline erfasst']);

    const none = await call<{ tasks: PublicTask[] }>(client, 'changes_since', { cursor: next.cursor });
    expect(none.tasks).toEqual([]);
  });

  it('meldet Löschungen über changes_since', async () => {
    const { client } = await connect();
    const { task } = await call<{ task: PublicTask }>(client, 'add_task', { text: 'Weg damit' });
    const { cursor } = await call<{ cursor: string }>(client, 'changes_since');

    await call(client, 'delete_task', { id: task.id });
    const { tasks } = await call<{ tasks: PublicTask[] }>(client, 'changes_since', { cursor });
    expect(tasks).toMatchObject([{ id: task.id, deleted: true }]);
  });

  describe('mit TIDYPEPPLE_ONLY_TAG', () => {
    it('zeigt nur Aufgaben mit dem Tag und versieht neue damit', async () => {
      await fromDeviceB('0190f000-0000-7000-8000-00000000000c', Date.now(), { title: 'Privat' });
      const { client } = await connect({ onlyTag: 'ai' });

      expect((await call<{ tasks: PublicTask[] }>(client, 'list_tasks')).tasks).toEqual([]);
      const failed = await client.callTool({ name: 'get_task', arguments: { id: '0190f000-0000-7000-8000-00000000000c' } });
      expect(failed.isError).toBe(true);

      const { task } = await call<{ task: PublicTask }>(client, 'add_task', { text: 'Für Claude' });
      expect(task.tags).toEqual(['ai']);

      // Den Tag selbst kann das LLM nicht entfernen – sonst verlöre es die Aufgabe aus der Sicht.
      const { task: updated } = await call<{ task: PublicTask }>(client, 'update_task', { id: task.id, tags: [] });
      expect(updated.tags).toEqual(['ai']);
    });
  });
});
