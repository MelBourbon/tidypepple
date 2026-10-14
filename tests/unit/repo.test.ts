import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, TidyDb } from '@/data/db';
import {
  addStep,
  completeTask,
  createContext,
  createTask,
  deleteContext,
  deleteTask,
  deleteTasks,
  ensureContexts,
  ensureProject,
  importRecords,
  initRepo,
  moveContext,
  moveTask,
  resetRepo,
  restoreTasks,
  setParent,
  undoComplete,
  updateTask,
} from '@/data/repo';
import { buildGraph, isProject, nextSteps } from '@/domain/projects';
import { isNewer } from '@/domain/hlc';

beforeEach(async () => {
  await resetRepo();
  await initRepo();
});

const graph = async () => buildGraph(await db.tasks.toArray());

describe('Schreibvorgänge', () => {
  it('legt eine Aufgabe mit sinnvollen Vorgaben an', async () => {
    const t = await createTask({ title: 'Müll rausbringen' });
    expect(t).toMatchObject({ title: 'Müll rausbringen', status: 'inbox', parentId: null, deletedAt: null });
    expect(t.highPriority).toBe(false);
    expect(await db.tasks.count()).toBe(1);
  });

  it('ergänzt die Priorität in Sicherungen, die sie noch nicht kannten', async () => {
    const t = await createTask({ title: 'Alt' });
    const { highPriority: _, attachments: __, ...legacy } = t;
    await importRecords({ tasks: [legacy as typeof t] });
    expect((await db.tasks.get(t.id))?.highPriority).toBe(false);
    expect((await db.tasks.get(t.id))?.attachments).toEqual([]);
  });

  it('repariert kaputte Felder einer Sicherung, statt sie zu übernehmen', async () => {
    const result = await importRecords({
      tasks: [
        {
          id: 'kaputt',
          title: 'Aus einer Datei',
          status: 'erledigt?',
          contexts: null,
          parentId: 'kaputt',
          dueDate: 'morgen',
          attachments: [{ id: 'a1', size: 'groß' }, 'Unsinn'],
          createdAt: 'gestern',
        },
        { id: 42, title: 'Ohne gültige ID' },
        'keine Aufgabe',
      ],
      contexts: [{ id: 'k1', name: 'Büro', order: 7 }, { id: 'k2' }],
    });

    expect(result).toEqual({ tasks: 1, contexts: 1 });
    expect(await db.tasks.get('kaputt')).toMatchObject({
      status: 'inbox',
      contexts: [],
      parentId: null,
      dueDate: null,
      createdAt: 0,
      attachments: [{ id: 'a1', size: 0, name: '', type: 'application/octet-stream', addedAt: 0 }],
    });
    expect(await db.contexts.get('k1')).toMatchObject({ name: 'Büro', order: 'a0', color: 'slate', deletedAt: null });
  });

  it('legt Kontexte aus einer Sicherung nicht doppelt an', async () => {
    // Standard-Kontexte, die das Gerät beim ersten Start angelegt hat.
    const local = await createContext('Büro');
    await db.meta.put({ key: 'contextFilter', value: [local.id] });
    const task = await createTask({ title: 'Schon da', contexts: [local.id] });

    // Die Sicherung stammt von einem älteren Gerät: gleicher Name, andere ID.
    const backupId = '00000000-0000-7000-8000-000000000001';
    await importRecords({
      contexts: [{ id: backupId, name: 'büro', color: 'slate', order: 'a0', deletedAt: null, hlc: '' }],
      tasks: [{ ...task, id: 'aus-sicherung', title: 'Aus der Sicherung', contexts: [backupId] }],
    });

    const live = (await db.contexts.toArray()).filter((c) => c.deletedAt === null);
    expect(live.map((c) => c.id)).toEqual([backupId]);
    // Alles, was auf den lokalen Kontext zeigte, zeigt jetzt auf den übernommenen.
    expect((await db.tasks.get(task.id))?.contexts).toEqual([backupId]);
    expect((await db.tasks.get('aus-sicherung'))?.contexts).toEqual([backupId]);
    expect((await db.meta.get('contextFilter'))?.value).toEqual([backupId]);
  });

  it('lässt eine Sicherung ohne Listen unangetastet', async () => {
    expect(await importRecords({ tasks: 'nichts', contexts: null })).toEqual({ tasks: 0, contexts: 0 });
  });

  it('markiert jede Änderung in der Outbox – genau einen Eintrag pro Record', async () => {
    const t = await createTask({ title: 'A' });
    await updateTask(t.id, { title: 'B' });
    await updateTask(t.id, { title: 'C' });
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.get(t.id))?.kind).toBe('task');
  });

  it('vergibt bei jedem Schreibvorgang einen neueren Zeitstempel', async () => {
    const t = await createTask({ title: 'A' });
    await updateTask(t.id, { title: 'B' });
    const updated = await db.tasks.get(t.id);
    expect(isNewer(updated!.hlc, t.hlc)).toBe(true);
  });

  it('löscht weich und stellt wieder her (Undo statt Rückfrage)', async () => {
    const t = await createTask({ title: 'Versehen' });
    const ids = await deleteTask(t.id);
    expect((await db.tasks.get(t.id))?.deletedAt).not.toBeNull();

    await restoreTasks(ids);
    expect((await db.tasks.get(t.id))?.deletedAt).toBeNull();
  });

  it('löscht Schritte mit, statt sie verwaist zurückzulassen', async () => {
    const parent = await createTask({ title: 'Projekt' });
    await addStep(parent.id, { title: 'Schritt 1' });
    await addStep(parent.id, { title: 'Schritt 2' });

    const ids = await deleteTask(parent.id);
    expect(ids).toHaveLength(3);
    const live = (await db.tasks.toArray()).filter((t) => t.deletedAt === null);
    expect(live).toHaveLength(0);
  });

  it('löscht mehrere Aufgaben so, dass ein Undo alle zurückholt', async () => {
    const a = await createTask({ title: 'A' });
    const b = await createTask({ title: 'B' });
    const ids = await deleteTasks([a.id, b.id]);
    expect([...ids].sort()).toEqual([a.id, b.id].sort());
    expect((await db.tasks.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(0);

    await restoreTasks(ids);
    expect((await db.tasks.toArray()).filter((t) => t.deletedAt === null)).toHaveLength(2);
  });

  it('setzt beim Erledigen den Zeitpunkt und nimmt ihn beim Wiederöffnen zurück', async () => {
    const t = await createTask({ title: 'A' });
    await completeTask(t.id);
    expect((await db.tasks.get(t.id))?.completedAt).toBeTypeOf('number');
  });

  it('setzt den Zeitpunkt auch, wenn der Status im Detail auf "Erledigt" gestellt wird', async () => {
    const t = await createTask({ title: 'A' });
    await updateTask(t.id, { status: 'done' });
    expect((await db.tasks.get(t.id))?.completedAt).toBeTypeOf('number');
    await updateTask(t.id, { status: 'next' });
    expect((await db.tasks.get(t.id))?.completedAt).toBeNull();
  });

  it('entfernt beim Erledigen Fälligkeit und Erinnerung, Undo holt sie zurück', async () => {
    const t = await createTask({ title: 'A', status: 'waiting', dueDate: '2026-01-01', dueTime: '09:00', reminderAt: '2026-01-01T08:00' });
    await completeTask(t.id);
    const done = await db.tasks.get(t.id);
    expect(done).toMatchObject({ status: 'done', dueDate: null, dueTime: null, reminderAt: null });

    await undoComplete(t);
    expect(await db.tasks.get(t.id)).toMatchObject({
      status: 'waiting',
      waitingSince: t.waitingSince,
      dueDate: '2026-01-01',
      dueTime: '09:00',
      reminderAt: '2026-01-01T08:00',
      completedAt: null,
    });
  });
});

describe('Wartezeit', () => {
  it('startet beim Wechsel auf "Wartet" und endet mit jedem anderen Status', async () => {
    const t = await createTask({ title: 'Angebot', status: 'next' });
    expect(t.waitingSince).toBeNull();

    await updateTask(t.id, { status: 'waiting' });
    const since = (await db.tasks.get(t.id))?.waitingSince;
    expect(since).toBeTypeOf('number');

    // Andere Änderungen lassen den Startzeitpunkt stehen.
    await updateTask(t.id, { waitingFor: 'Max', status: 'waiting' });
    expect((await db.tasks.get(t.id))?.waitingSince).toBe(since);

    await completeTask(t.id);
    expect((await db.tasks.get(t.id))?.waitingSince).toBeNull();
  });

  it('setzt den Zeitpunkt auch beim Anlegen als wartend, übernimmt aber einen mitgebrachten', async () => {
    expect((await createTask({ title: 'A', status: 'waiting' })).waitingSince).toBeTypeOf('number');
    expect((await createTask({ title: 'B', status: 'waiting', waitingSince: 42 })).waitingSince).toBe(42);
  });
});

describe('Migration', () => {
  it('gibt vorhandenen Aufgaben beim Update die Priorität "normal"', async () => {
    const name = 'migration-v1';
    const v1 = new Dexie(name);
    v1.version(1).stores({ tasks: 'id, status, parentId, dueDate, createdAt, *contexts' });
    await v1.table('tasks').put({ id: 'alt', title: 'Von vorher', contexts: [] });
    v1.close();

    const v2 = new TidyDb(name);
    expect((await v2.tasks.get('alt'))?.highPriority).toBe(false);
    expect((await v2.tasks.get('alt'))?.attachments).toEqual([]);
    await v2.delete();
  });
});

describe('Schritte und Projekte', () => {
  it('befördert schon beim ersten Schritt automatisch zum Projekt', async () => {
    const parent = await createTask({ title: 'Umzug', status: 'next' });

    const first = await addStep(parent.id, { title: 'Kartons kaufen' });
    expect(first.promoted).toBe(true);
    expect(isProject(await graph(), (await db.tasks.get(parent.id))!)).toBe(true);
    expect((await db.tasks.get(parent.id))?.pinnedAsProject).toBe(true);

    const second = await addStep(parent.id, { title: 'Transporter mieten' });
    expect(second.promoted).toBe(false);
  });

  it('hält Schritte in Eingabereihenfolge und liefert den ersten als nächsten Schritt', async () => {
    const parent = await createTask({ title: 'Projekt' });
    const a = await addStep(parent.id, { title: 'Erst das' });
    await addStep(parent.id, { title: 'Dann das' });

    const g = await graph();
    expect(nextSteps(g, g.byId.get(parent.id)!).map((t) => t.title)).toEqual(['Erst das']);
    expect(a.step.order < (await db.tasks.get((await graph()).childrenOf.get(parent.id)![1]!.id))!.order).toBe(true);
  });

  it('verschiebt einen Schritt vor einen anderen, ohne andere Records anzufassen', async () => {
    const parent = await createTask({ title: 'Projekt' });
    const a = await addStep(parent.id, { title: 'A' });
    const b = await addStep(parent.id, { title: 'B' });

    await moveTask(b.step.id, { beforeId: a.step.id });

    const g = await graph();
    expect(g.childrenOf.get(parent.id)!.map((t) => t.title)).toEqual(['B', 'A']);
    // Fractional Indexing: nur der bewegte Record wurde geschrieben.
    expect((await db.tasks.get(a.step.id))!.order).toBe(a.step.order);
  });

  it('macht den nächsten Schritt sichtbar, sobald der vorige erledigt ist', async () => {
    const parent = await createTask({ title: 'Projekt' });
    const a = await addStep(parent.id, { title: 'A' });
    await addStep(parent.id, { title: 'B' });

    await completeTask(a.step.id);
    const g = await graph();
    expect(nextSteps(g, g.byId.get(parent.id)!).map((t) => t.title)).toEqual(['B']);
  });
});

describe('Kontexte', () => {
  it('verschiebt einen Kontext, ohne die anderen anzufassen, und markiert nur ihn für den Sync', async () => {
    const a = await createContext('büro');
    const b = await createContext('telefon');
    const c = await createContext('zuhause');
    await db.outbox.clear();

    await moveContext(c.id, { beforeId: a.id });

    const names = (await db.contexts.orderBy('order').toArray()).map((x) => x.name);
    expect(names).toEqual(['zuhause', 'büro', 'telefon']);
    expect((await db.contexts.get(b.id))!.order).toBe(b.order);
    expect((await db.outbox.toArray()).map((e) => e.recordId)).toEqual([c.id]);
  });

  it('legt beim Erfassen fehlende Kontexte an und verwendet vorhandene wieder', async () => {
    const first = await ensureContexts(['büro', 'telefon']);
    const second = await ensureContexts(['Büro']);
    expect(first).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(await db.contexts.count()).toBe(2);
  });

  it('entfernt einen gelöschten Kontext aus allen Aufgaben', async () => {
    const c = await createContext('büro');
    const t = await createTask({ title: 'A', contexts: [c.id] });

    await deleteContext(c.id);
    expect((await db.tasks.get(t.id))?.contexts).toEqual([]);
    expect((await db.contexts.get(c.id))?.deletedAt).not.toBeNull();
  });
});

describe('setParent', () => {
  it('stellt die Aufgabe ans Ende der Schritte und befördert zum Projekt', async () => {
    const other = await createTask({ title: 'Renovieren' });
    const parent = await createTask({ title: 'Umzug' });
    const first = await addStep(parent.id, { title: 'Kartons' });
    const loose = await createTask({ title: 'Transporter' });

    expect(await setParent(loose.id, other.id)).toBe(true);
    expect((await db.tasks.get(other.id))!.pinnedAsProject).toBe(true);
    expect(await setParent(loose.id, parent.id)).toBe(true);
    const g = await graph();
    const moved = g.byId.get(loose.id)!;
    expect(moved.parentId).toBe(parent.id);
    expect(moved.order > g.byId.get(first.step.id)!.order).toBe(true);
    expect(g.byId.get(parent.id)!.pinnedAsProject).toBe(true);
  });

  it('lehnt Ziele unter der Aufgabe selbst ab und löst die Zuordnung mit null', async () => {
    const parent = await createTask({ title: 'Umzug' });
    const { step } = await addStep(parent.id, { title: 'Kartons' });

    expect(await setParent(parent.id, step.id)).toBe(false);
    expect(await setParent(parent.id, parent.id)).toBe(false);
    expect((await db.tasks.get(parent.id))!.parentId).toBeNull();

    expect(await setParent(step.id, null)).toBe(true);
    expect((await db.tasks.get(step.id))!.parentId).toBeNull();
  });
});

describe('ensureProject', () => {
  it('findet ein Projekt ohne Rücksicht auf Groß-/Kleinschreibung und legt sonst eins an', async () => {
    const existing = await createTask({ title: 'Umzug' });
    expect((await ensureProject('umzug')).id).toBe(existing.id);
    expect((await db.tasks.get(existing.id))!.pinnedAsProject).toBe(true);

    const created = await ensureProject('Garten');
    expect(created).toMatchObject({ title: 'Garten', pinnedAsProject: true, status: 'next' });
  });
});
