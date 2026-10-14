import { describe, expect, it } from 'vitest';
import { groupByContext, groupByStatus, planReorder, sortTasks, type SortSpec } from '@/domain/sort';
import type { Task } from '@/domain/types';
import { context, task } from './factory';

const ids = (tasks: readonly { id: string }[]): string[] => tasks.map((t) => t.id);

describe('sortTasks', () => {
  const withDue = [
    task({ id: 'spaet', dueDate: '2026-12-01' }),
    task({ id: 'ohne', dueDate: null }),
    task({ id: 'frueh', dueDate: '2026-01-01' }),
  ];

  it('sortiert nach Fälligkeit und stellt Aufgaben ohne Datum ans Ende', () => {
    expect(ids(sortTasks(withDue, { key: 'due', dir: 'asc' }))).toEqual(['frueh', 'spaet', 'ohne']);
  });

  it('lässt Aufgaben ohne Datum auch absteigend am Ende', () => {
    expect(ids(sortTasks(withDue, { key: 'due', dir: 'desc' }))).toEqual(['spaet', 'frueh', 'ohne']);
  });

  it('nutzt die Uhrzeit als Feinsortierung innerhalb eines Tages', () => {
    const tasks = [
      task({ id: 'nachmittag', dueDate: '2026-01-01', dueTime: '15:00' }),
      task({ id: 'ganztags', dueDate: '2026-01-01', dueTime: null }),
      task({ id: 'morgens', dueDate: '2026-01-01', dueTime: '08:00' }),
    ];
    expect(ids(sortTasks(tasks, { key: 'due', dir: 'asc' }))).toEqual(['morgens', 'nachmittag', 'ganztags']);
  });

  it('stellt Wichtiges innerhalb eines Tages nach vorn, aber nicht vor frühere Tage', () => {
    const tasks = [
      task({ id: 'heute', dueDate: '2026-01-02', dueTime: '08:00' }),
      task({ id: 'heute-wichtig', dueDate: '2026-01-02', dueTime: '17:00', highPriority: true }),
      task({ id: 'gestern', dueDate: '2026-01-01' }),
      task({ id: 'morgen-wichtig', dueDate: '2026-01-03', highPriority: true }),
    ];
    expect(ids(sortTasks(tasks, { key: 'due', dir: 'asc' }))).toEqual(['gestern', 'heute-wichtig', 'heute', 'morgen-wichtig']);
    expect(ids(sortTasks(tasks, { key: 'due', dir: 'desc' }))).toEqual(['morgen-wichtig', 'heute-wichtig', 'heute', 'gestern']);
  });

  it('sortiert nach Kontext-Reihenfolge und stellt kontextlose Aufgaben ans Ende', () => {
    const buero = context({ id: 'c-buero' });
    const telefon = context({ id: 'c-telefon' });
    const tasks = [
      task({ id: 'ohne', contexts: [] }),
      task({ id: 'telefon', contexts: ['c-telefon'] }),
      task({ id: 'buero', contexts: ['c-buero'] }),
    ];
    expect(ids(sortTasks(tasks, { key: 'context', dir: 'asc' }, [buero, telefon]))).toEqual([
      'buero',
      'telefon',
      'ohne',
    ]);
  });

  it('sortiert nach Erstellungsdatum in beide Richtungen', () => {
    const tasks = [task({ id: 'alt', createdAt: 1 }), task({ id: 'neu', createdAt: 9 })];
    expect(ids(sortTasks(tasks, { key: 'created', dir: 'asc' }))).toEqual(['alt', 'neu']);
    expect(ids(sortTasks(tasks, { key: 'created', dir: 'desc' }))).toEqual(['neu', 'alt']);
  });

  it('ist stabil: gleiche Schlüssel behalten eine feste Reihenfolge', () => {
    const tasks = [
      task({ id: 'b', dueDate: '2026-01-01', order: 'a2' }),
      task({ id: 'a', dueDate: '2026-01-01', order: 'a1' }),
    ];
    const once = ids(sortTasks(tasks, { key: 'due', dir: 'asc' }));
    const twice = ids(sortTasks([...tasks].reverse(), { key: 'due', dir: 'asc' }));
    expect(once).toEqual(twice);
  });
});

describe('groupByContext', () => {
  const buero = context({ id: 'c-buero' });
  const telefon = context({ id: 'c-telefon' });
  const groups = (tasks: readonly ReturnType<typeof task>[], dir: 'asc' | 'desc') =>
    groupByContext(sortTasks(tasks, { key: 'context', dir }, [buero, telefon]), [buero, telefon]).map((g) => [
      g.contextId,
      ids(g.tasks),
    ]);

  it('bildet je Kontext einen Abschnitt, kontextlose Aufgaben zuletzt', () => {
    const tasks = [
      task({ id: 'ohne', contexts: [] }),
      task({ id: 'telefon', contexts: ['c-telefon'] }),
      task({ id: 'buero', contexts: ['c-buero'] }),
    ];
    expect(groups(tasks, 'asc')).toEqual([
      ['c-buero', ['buero']],
      ['c-telefon', ['telefon']],
      [null, ['ohne']],
    ]);
    expect(groups(tasks, 'desc')).toEqual([
      ['c-telefon', ['telefon']],
      ['c-buero', ['buero']],
      [null, ['ohne']],
    ]);
  });

  it('ordnet mehrere Kontexte dem obersten zu und gelöschte Kontexte "ohne Kontext"', () => {
    const tasks = [
      task({ id: 'beide', contexts: ['c-telefon', 'c-buero'] }),
      task({ id: 'geloescht', contexts: ['c-weg'] }),
      task({ id: 'ohne', contexts: [] }),
    ];
    expect(groups(tasks, 'desc')).toEqual([
      ['c-buero', ['beide']],
      [null, ['geloescht', 'ohne']],
    ]);
  });
});

describe('Status', () => {
  const tasks = [
    task({ id: 'irgendwann', status: 'someday' }),
    task({ id: 'wartet', status: 'waiting' }),
    task({ id: 'naechste', status: 'next' }),
    task({ id: 'inbox', status: 'inbox' }),
    task({ id: 'terminiert', status: 'scheduled' }),
  ];

  it('sortiert in Arbeitsreihenfolge wie die Board-Spalten', () => {
    expect(ids(sortTasks(tasks, { key: 'status', dir: 'asc' }))).toEqual([
      'inbox',
      'naechste',
      'terminiert',
      'wartet',
      'irgendwann',
    ]);
    expect(ids(sortTasks(tasks, { key: 'status', dir: 'desc' }))[0]).toBe('irgendwann');
  });

  it('bildet je Status einen Abschnitt in Sortierreihenfolge', () => {
    const more = [...tasks, task({ id: 'naechste-2', status: 'next' })];
    const groups = groupByStatus(sortTasks(more, { key: 'status', dir: 'desc' })).map((g) => [g.status, ids(g.tasks)]);
    expect(groups.map(([status]) => status)).toEqual(['someday', 'waiting', 'scheduled', 'next', 'inbox']);
    expect(groups[3]?.[1]).toHaveLength(2);
  });
});

describe('manuelle Sortierung', () => {
  const manual: SortSpec = { key: 'manual', dir: 'asc' };

  it('folgt listOrder, nie verschobene Aufgaben stehen hinten nach order', () => {
    const tasks = [
      task({ id: 'neu2', order: 'a2', listOrder: null }),
      task({ id: 'b', order: 'a9', listOrder: 'a1' }),
      task({ id: 'neu1', order: 'a1', listOrder: null }),
      task({ id: 'a', order: 'a5', listOrder: 'a0' }),
    ];
    expect(ids(sortTasks(tasks, manual))).toEqual(['a', 'b', 'neu1', 'neu2']);
  });

  /** Wendet einen Plan an und sortiert neu – so, wie die Liste nach dem Drop aussieht. */
  const apply = (shown: readonly Task[], from: number, to: number, spec = manual): string[] => {
    const plan = new Map(planReorder(shown, from, to, spec.dir).map((u) => [u.id, u.listOrder]));
    return ids(sortTasks(shown.map((t) => ({ ...t, listOrder: plan.get(t.id) ?? t.listOrder })), spec));
  };

  it('vergibt beim ersten Verschieben allen angezeigten Aufgaben Werte', () => {
    const shown = sortTasks([task({ id: 'x' }), task({ id: 'y' }), task({ id: 'z' })], manual);
    expect(planReorder(shown, 2, 0)).toHaveLength(3);
    expect(apply(shown, 2, 0)).toEqual(['z', 'x', 'y']);
  });

  it('ändert danach nur die verschobene Aufgabe', () => {
    const shown = sortTasks(
      [task({ id: 'x', listOrder: 'a0' }), task({ id: 'y', listOrder: 'a1' }), task({ id: 'z', listOrder: 'a2' })],
      manual,
    );
    expect(planReorder(shown, 0, 2).map((u) => u.id)).toEqual(['x']);
    expect(apply(shown, 0, 2)).toEqual(['y', 'z', 'x']);
    expect(apply(shown, 2, 1)).toEqual(['x', 'z', 'y']);
  });

  it('vergibt neu, wenn Nachbarn gleiche Werte haben', () => {
    const shown = sortTasks(
      [task({ id: 'x', listOrder: 'a0' }), task({ id: 'y', listOrder: 'a1' }), task({ id: 'z', listOrder: 'a1' })],
      manual,
    );
    expect(apply(shown, 0, 1)).toEqual(['y', 'x', 'z']);
  });

  it('berücksichtigt absteigende Anzeige', () => {
    const desc: SortSpec = { key: 'manual', dir: 'desc' };
    const shown = sortTasks(
      [task({ id: 'x', listOrder: 'a0' }), task({ id: 'y', listOrder: 'a1' }), task({ id: 'z', listOrder: 'a2' })],
      desc,
    );
    expect(ids(shown)).toEqual(['z', 'y', 'x']);
    expect(apply(shown, 0, 2, desc)).toEqual(['y', 'x', 'z']);
  });

  it('tut nichts, wenn die Position gleich bleibt', () => {
    const shown = [task(), task()];
    expect(planReorder(shown, 1, 1)).toEqual([]);
  });
});
