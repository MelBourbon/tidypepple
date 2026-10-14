import { describe, expect, it } from 'vitest';
import {
  allOpenTasks,
  bulkDeletable,
  completionBucket,
  doneTasks,
  engageableFrom,
  groupByCompletion,
} from '@/domain/listQuery';
import { buildGraph } from '@/domain/projects';
import { waitingDays } from '@/domain/waiting';
import { daysSince } from '@/domain/dates';
import { task } from './factory';

const ids = (tasks: readonly { id: string }[]): string[] => tasks.map((t) => t.id).sort();

describe('engageableTasks', () => {
  it('zeigt eigenständige Aufgaben', () => {
    expect(ids(engageableFrom([task({ id: 'a' })]))).toEqual(['a']);
  });

  it('zeigt vom Projekt nur den nächsten Schritt, und das Projekt selbst nie', () => {
    const list = engageableFrom([
      task({ id: 'p', pinnedAsProject: true }),
      task({ id: 's1', parentId: 'p', order: 'a1' }),
      task({ id: 's2', parentId: 'p', order: 'a2' }),
    ]);
    expect(ids(list)).toEqual(['s1']);
  });

  it('macht schon aus einem einzigen Schritt ein Projekt – nur der Schritt steht in "Next"', () => {
    const list = engageableFrom([task({ id: 'a' }), task({ id: 'step', parentId: 'a' })]);
    expect(ids(list)).toEqual(['step']);
  });

  it('zeigt ein Projekt mit lauter erledigten Schritten selbst in "Next"', () => {
    const list = engageableFrom([
      task({ id: 'p', pinnedAsProject: true }),
      task({ id: 's1', parentId: 'p', status: 'done' }),
      task({ id: 's2', parentId: 'p', status: 'done' }),
      task({ id: 'leer', pinnedAsProject: true }),
    ]);
    expect(ids(list)).toEqual(['p']);
  });

  it('lässt ein fertiges Projekt im Status Irgendwann aus "Next"', () => {
    const list = engageableFrom([
      task({ id: 'p', pinnedAsProject: true, status: 'someday' }),
      task({ id: 's1', parentId: 'p', status: 'done' }),
    ]);
    expect(ids(list)).toEqual([]);
  });

  it('blendet erledigte, gelöschte und Someday-Aufgaben aus', () => {
    const list = engageableFrom([
      task({ id: 'done', status: 'done' }),
      task({ id: 'weg', deletedAt: 1 }),
      task({ id: 'irgendwann', status: 'someday' }),
      task({ id: 'offen' }),
    ]);
    expect(ids(list)).toEqual(['offen']);
  });

  it('hält Inbox und Waiting aus der Aktionsliste heraus', () => {
    const list = engageableFrom([
      task({ id: 'inbox', status: 'inbox' }),
      task({ id: 'wartet', status: 'waiting' }),
      task({ id: 'jetzt' }),
    ]);
    expect(ids(list)).toEqual(['jetzt']);
  });

  it('holt Wartendes ab dem Fälligkeitstag zum Nachfassen herein', () => {
    const tasks = [
      task({ id: 'ohne-frist', status: 'waiting' }),
      task({ id: 'morgen', status: 'waiting', dueDate: '2026-10-05' }),
      task({ id: 'heute', status: 'waiting', dueDate: '2026-10-04' }),
      task({ id: 'abgelaufen', status: 'waiting', dueDate: '2026-10-03' }),
    ];
    expect(ids(engageableFrom(tasks, { referenceDate: '2026-10-04' }))).toEqual(['abgelaufen', 'heute']);
    // Eine eigene Statusliste (Board) bleibt unberührt.
    expect(ids(engageableFrom(tasks, { referenceDate: '2026-10-04', statuses: ['next'] }))).toEqual([]);
  });

  it('lässt auch fälliges Nachfassen hinter späteren Projektschritten zurück', () => {
    const list = engageableFrom(
      [
        task({ id: 'p', pinnedAsProject: true }),
        task({ id: 's1', parentId: 'p', order: 'a1' }),
        task({ id: 's2', parentId: 'p', order: 'a2', status: 'waiting', dueDate: '2026-10-01' }),
      ],
      { referenceDate: '2026-10-04' },
    );
    expect(ids(list)).toEqual(['s1']);
  });

  it('blendet zurückgestellte Aufgaben bis zum Defer-Datum aus', () => {
    const tasks = [
      task({ id: 'später', deferDate: '2026-10-05' }),
      task({ id: 'fällig', deferDate: '2026-10-01' }),
    ];
    expect(ids(engageableFrom(tasks, { referenceDate: '2026-10-01' }))).toEqual(['fällig']);
  });

  it('filtert nach Kontext (ODER) und optional nach allen Kontexten (UND)', () => {
    const tasks = [
      task({ id: 'buero', contexts: ['c1'] }),
      task({ id: 'beides', contexts: ['c1', 'c2'] }),
      task({ id: 'ohne', contexts: [] }),
    ];
    expect(ids(engageableFrom(tasks, { contexts: ['c1'] }))).toEqual(['beides', 'buero']);
    expect(ids(engageableFrom(tasks, { contexts: ['c1', 'c2'], matchAllContexts: true }))).toEqual(['beides']);
  });

  it('filtert auf wichtige Aufgaben', () => {
    const tasks = [task({ id: 'wichtig', highPriority: true }), task({ id: 'normal' })];
    expect(ids(engageableFrom(tasks, { highPriorityOnly: true }))).toEqual(['wichtig']);
    expect(ids(engageableFrom(tasks, { highPriorityOnly: false }))).toEqual(['normal', 'wichtig']);
  });

  it('sucht in Titel und Notizen', () => {
    const tasks = [task({ id: 'a', title: 'Rechnung schreiben' }), task({ id: 'b', notes: 'Rechnung prüfen' }), task({ id: 'c', title: 'Müll' })];
    expect(ids(engageableFrom(tasks, { search: 'rechnung' }))).toEqual(['a', 'b']);
  });

  it('filtert nach Tags (ODER), ohne auf Groß- und Kleinschreibung zu achten', () => {
    const tasks = [
      task({ id: 'steuer', tags: ['Steuer'] }),
      task({ id: 'beides', tags: ['steuer', 'privat'] }),
      task({ id: 'privat', tags: ['privat'] }),
      task({ id: 'ohne' }),
    ];
    expect(ids(engageableFrom(tasks, { tags: ['steuer'] }))).toEqual(['beides', 'steuer']);
    expect(ids(engageableFrom(tasks, { tags: ['Steuer', 'privat'] }))).toEqual(['beides', 'privat', 'steuer']);
    expect(ids(engageableFrom(tasks, { tags: [] }))).toEqual(['beides', 'ohne', 'privat', 'steuer']);
  });

  it('findet Tags in der Suche, mit # nur unter den Tags', () => {
    const tasks = [
      task({ id: 'tag', title: 'Belege sortieren', tags: ['Steuer'] }),
      task({ id: 'titel', title: 'Steuer überweisen' }),
      task({ id: 'beides', title: 'Steuer prüfen', tags: ['privat'] }),
    ];
    expect(ids(engageableFrom(tasks, { search: 'steuer' }))).toEqual(['beides', 'tag', 'titel']);
    expect(ids(engageableFrom(tasks, { search: '#ste' }))).toEqual(['tag']);
    expect(ids(engageableFrom(tasks, { search: 'steuer #privat' }))).toEqual(['beides']);
  });

  it('zeigt jeden nächsten Schritt genau einmal', () => {
    const list = engageableFrom([
      task({ id: 'p', pinnedAsProject: true, projectMode: 'parallel' }),
      task({ id: 's1', parentId: 'p', order: 'a1' }),
      task({ id: 's2', parentId: 'p', order: 'a2' }),
    ]);
    expect(list.map((t) => t.id).sort()).toEqual(['s1', 's2']);
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
  });
});

describe('ruhende Projekte', () => {
  const brainstorm = (status: 'waiting' | 'scheduled' | 'someday') => [
    task({ id: 'p', status, pinnedAsProject: true }),
    task({ id: 's1', parentId: 'p', order: 'a1' }),
    task({ id: 's2', parentId: 'p', order: 'a2' }),
  ];

  it.each(['waiting', 'scheduled', 'someday'] as const)('lässt die Schritte eines Projekts im Status %s aus "Next"', (status) => {
    expect(ids(engageableFrom(brainstorm(status)))).toEqual([]);
  });

  it('gilt auch für Teilprojekte eines ruhenden Projekts', () => {
    const list = engageableFrom([
      task({ id: 'p', status: 'someday', pinnedAsProject: true }),
      task({ id: 'sub', parentId: 'p', order: 'a1', pinnedAsProject: true }),
      task({ id: 'step', parentId: 'sub', order: 'a1' }),
    ]);
    expect(ids(list)).toEqual([]);
  });

  it('zeigt in "All" das ruhende Projekt unter seinem Status, aber nicht seine Schritte', () => {
    const graph = buildGraph([
      ...brainstorm('someday'),
      task({ id: 'sub', parentId: 'p', order: 'a3', pinnedAsProject: true }),
      task({ id: 'sub-1', parentId: 'sub', order: 'a1' }),
      task({ id: 'läuft', pinnedAsProject: true }),
      task({ id: 'läuft-1', parentId: 'läuft', order: 'a1' }),
    ]);
    expect(ids(allOpenTasks(graph))).toEqual(['läuft-1', 'p']);
    expect(ids(allOpenTasks(graph, { statuses: ['someday'] }))).toEqual(['p']);
  });
});

describe('allOpenTasks', () => {
  it('zeigt jeden offenen Schritt und jeden Status, aber keine Projekte', () => {
    const tasks = [
      task({ id: 'projekt', status: 'next' }),
      task({ id: 'schritt-1', parentId: 'projekt', order: 'a' }),
      task({ id: 'schritt-2', parentId: 'projekt', order: 'b', status: 'waiting' }),
      task({ id: 'irgendwann', status: 'someday' }),
      task({ id: 'erledigt', status: 'done' }),
    ];
    expect(ids(allOpenTasks(buildGraph(tasks)))).toEqual(['irgendwann', 'schritt-1', 'schritt-2']);
  });

  it('filtert nach mehreren Status, leer heißt alle', () => {
    const graph = buildGraph([
      task({ id: 'inbox', status: 'inbox' }),
      task({ id: 'next', status: 'next' }),
      task({ id: 'wartet', status: 'waiting' }),
      task({ id: 'irgendwann', status: 'someday' }),
      task({ id: 'erledigt', status: 'done' }),
    ]);
    expect(ids(allOpenTasks(graph, { statuses: ['waiting', 'someday'] }))).toEqual(['irgendwann', 'wartet']);
    // Ein erledigter Status im Filter holt nichts Erledigtes in "All".
    expect(ids(allOpenTasks(graph, { statuses: ['done'] }))).toEqual([]);
    expect(ids(allOpenTasks(graph, { statuses: [] }))).toEqual(['inbox', 'irgendwann', 'next', 'wartet']);
  });
});

describe('doneTasks', () => {
  it('zeigt erledigte Aufgaben inklusive Projekten und Schritten, zuletzt erledigte zuerst', () => {
    const graph = buildGraph([
      task({ id: 'p', status: 'done', pinnedAsProject: true, completedAt: 1 }),
      task({ id: 's', parentId: 'p', status: 'done', completedAt: 3 }),
      task({ id: 'a', status: 'done', completedAt: 2 }),
      task({ id: 'offen' }),
      task({ id: 'weg', status: 'done', completedAt: 4, deletedAt: 5 }),
    ]);
    expect(doneTasks(graph).map((t) => t.id)).toEqual(['s', 'a', 'p']);
  });

  it('sucht in Titel und Notizen', () => {
    const graph = buildGraph([
      task({ id: 'a', status: 'done', title: 'Steuer' }),
      task({ id: 'b', status: 'done', notes: 'steuerlich relevant' }),
      task({ id: 'c', status: 'done', title: 'Müll' }),
    ]);
    expect(ids(doneTasks(graph, 'steuer'))).toEqual(['a', 'b']);
  });

  it('ordnet nach Erledigungstag: heute, letzte 7 Tage, älter', () => {
    const at = (iso: string): number => new Date(`${iso}T12:00:00`).getTime();
    expect(completionBucket(at('2026-09-29'), '2026-09-29')).toBe('today');
    expect(completionBucket(at('2026-09-23'), '2026-09-29')).toBe('week');
    expect(completionBucket(at('2026-09-22'), '2026-09-29')).toBe('older');
    expect(completionBucket(null, '2026-09-29')).toBe('older');

    const groups = groupByCompletion(
      [task({ id: 'h', completedAt: at('2026-09-29') }), task({ id: 'x', completedAt: at('2026-01-01') })],
      '2026-09-29',
    );
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'older']);
  });

  it('"Alle löschen" lässt erledigte Projekte mit offenen Schritten stehen', () => {
    const graph = buildGraph([
      task({ id: 'p', status: 'done', pinnedAsProject: true }),
      task({ id: 'offen', parentId: 'p' }),
      task({ id: 'q', status: 'done', pinnedAsProject: true }),
      task({ id: 'fertig', parentId: 'q', status: 'done' }),
    ]);
    expect(ids(bulkDeletable(graph, doneTasks(graph)))).toEqual(['fertig', 'q']);
  });
});

describe('daysSince', () => {
  it('zählt Kalendertage, nicht 24-Stunden-Blöcke', () => {
    expect(daysSince(new Date(2026, 9, 3, 23, 59).getTime(), '2026-10-04')).toBe(1);
    expect(daysSince(new Date(2026, 9, 4, 0, 1).getTime(), '2026-10-04')).toBe(0);
    expect(daysSince(new Date(2026, 9, 9).getTime(), '2026-10-04')).toBe(0);
  });
});

describe('waitingDays', () => {
  it('zählt Kalendertage, nicht 24-h-Blöcke', () => {
    expect(waitingDays(new Date(2026, 9, 3, 23, 30).getTime(), '2026-10-04')).toBe(1);
    expect(waitingDays(new Date(2026, 9, 4, 8, 0).getTime(), '2026-10-04')).toBe(0);
    expect(waitingDays(new Date(2026, 8, 20).getTime(), '2026-10-04')).toBe(14);
  });

  it('kennt ohne Startzeitpunkt keine Dauer', () => {
    expect(waitingDays(null, '2026-10-04')).toBeNull();
  });
});
