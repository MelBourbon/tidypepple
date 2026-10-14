import { describe, expect, it } from 'vitest';
import {
  allStepsDone,
  ancestorsOf,
  buildGraph,
  isProject,
  nextSteps,
  nextStepIds,
  projectCandidates,
  projectProgress,
  shouldAutoPromote,
} from '@/domain/projects';
import { task } from './factory';

describe('isProject', () => {
  it('macht schon eine Aufgabe mit einem offenen Schritt zum Projekt', () => {
    const parent = task({ id: 'p' });
    const graph = buildGraph([parent, task({ parentId: 'p' })]);
    expect(isProject(graph, parent)).toBe(true);
  });

  it('behandelt eine Aufgabe ohne Schritte als normale Aufgabe', () => {
    const parent = task({ id: 'p' });
    expect(isProject(buildGraph([parent]), parent)).toBe(false);
  });

  it('bleibt Projekt, wenn alle Schritte erledigt sind (dauerhafte Beförderung)', () => {
    const parent = task({ id: 'p', pinnedAsProject: true });
    const graph = buildGraph([
      parent,
      task({ parentId: 'p', status: 'done' }),
      task({ parentId: 'p', status: 'done' }),
    ]);
    expect(isProject(graph, parent)).toBe(true);
    expect(allStepsDone(graph, parent)).toBe(true);
    expect(projectProgress(graph, parent)).toMatchObject({ stalled: false, allDone: true });
  });

  it('gilt ohne Schritte als festgefahren, nicht als fertig', () => {
    const parent = task({ id: 'p', pinnedAsProject: true });
    const graph = buildGraph([parent]);
    expect(allStepsDone(graph, parent)).toBe(false);
    expect(projectProgress(graph, parent)).toMatchObject({ stalled: true, allDone: false });
  });
});

describe('shouldAutoPromote', () => {
  it('greift schon beim ersten Schritt', () => {
    const parent = task({ id: 'p' });
    expect(shouldAutoPromote(buildGraph([parent]), parent)).toBe(false);
    expect(shouldAutoPromote(buildGraph([parent, task({ parentId: 'p' })]), parent)).toBe(true);
  });

  it('greift nicht erneut, wenn schon befördert wurde', () => {
    const parent = task({ id: 'p', pinnedAsProject: true });
    const graph = buildGraph([parent, task({ parentId: 'p' }), task({ parentId: 'p' })]);
    expect(shouldAutoPromote(graph, parent)).toBe(false);
  });
});

describe('nextSteps', () => {
  const parent = task({ id: 'p', pinnedAsProject: true });
  const a = task({ id: 'a', parentId: 'p', order: 'a1' });
  const b = task({ id: 'b', parentId: 'p', order: 'a2' });
  const c = task({ id: 'c', parentId: 'p', order: 'a3' });

  it('liefert bei sequenziellen Projekten genau den ersten offenen Schritt', () => {
    const graph = buildGraph([parent, a, b, c]);
    expect(nextSteps(graph, parent).map((t) => t.id)).toEqual(['a']);
  });

  it('überspringt erledigte Schritte', () => {
    const graph = buildGraph([parent, { ...a, status: 'done' as const }, b, c]);
    expect(nextSteps(graph, parent).map((t) => t.id)).toEqual(['b']);
  });

  it('liefert bei parallelen Projekten alle offenen Schritte', () => {
    const graph = buildGraph([{ ...parent, projectMode: 'parallel' as const }, a, b, c]);
    expect(nextSteps(graph, { ...parent, projectMode: 'parallel' }).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('steigt in Teilprojekte hinab statt einen Container als Aktion zu zeigen', () => {
    const sub = task({ id: 'sub', parentId: 'p', order: 'a1', pinnedAsProject: true });
    const leaf = task({ id: 'leaf', parentId: 'sub', order: 'a1' });
    const graph = buildGraph([parent, sub, leaf, b]);
    expect(nextSteps(graph, parent).map((t) => t.id)).toEqual(['leaf']);
  });

  it('zeigt ein Teilprojekt mit lauter erledigten Schritten selbst als Aktion', () => {
    const sub = task({ id: 'sub', parentId: 'p', order: 'a1', pinnedAsProject: true });
    const leaf = task({ id: 'leaf', parentId: 'sub', order: 'a1', status: 'done' });
    const graph = buildGraph([parent, sub, leaf, b]);
    expect(nextSteps(graph, parent).map((t) => t.id)).toEqual(['sub']);
  });

  it('bricht bei zyklischen Eltern-Beziehungen ab, statt endlos zu laufen', () => {
    const x = task({ id: 'x', parentId: 'y', pinnedAsProject: true });
    const y = task({ id: 'y', parentId: 'x', pinnedAsProject: true });
    const graph = buildGraph([x, y]);
    expect(() => nextSteps(graph, x)).not.toThrow();
  });
});

describe('buildGraph', () => {
  it('lässt gelöschte Aufgaben weg', () => {
    const graph = buildGraph([task({ id: 'gone', deletedAt: 1 }), task({ id: 'here' })]);
    expect([...graph.byId.keys()]).toEqual(['here']);
  });

  it('macht Kinder eines gelöschten Projekts zu Wurzeln, statt sie unerreichbar zu machen', () => {
    const graph = buildGraph([task({ id: 'p', deletedAt: 1 }), task({ id: 'child', parentId: 'p' })]);
    expect(graph.roots.map((t) => t.id)).toEqual(['child']);
  });
});

describe('nextStepIds / ancestorsOf', () => {
  it('sammelt die nächsten Schritte aller Projekte', () => {
    const p1 = task({ id: 'p1', pinnedAsProject: true });
    const p2 = task({ id: 'p2', pinnedAsProject: true });
    const graph = buildGraph([
      p1,
      task({ id: 's1', parentId: 'p1', order: 'a1' }),
      task({ id: 's2', parentId: 'p1', order: 'a2' }),
      p2,
      task({ id: 's3', parentId: 'p2', order: 'a1' }),
    ]);
    expect([...nextStepIds(graph)].sort()).toEqual(['s1', 's3']);
  });

  it('liefert die Elternkette von der Wurzel abwärts', () => {
    const root = task({ id: 'r', pinnedAsProject: true });
    const mid = task({ id: 'm', parentId: 'r', pinnedAsProject: true });
    const leaf = task({ id: 'l', parentId: 'm' });
    const graph = buildGraph([root, mid, leaf]);
    expect(ancestorsOf(graph, leaf).map((t) => t.id)).toEqual(['r', 'm']);
  });
});

describe('projectCandidates', () => {
  it('bietet Projekte an, aber nicht die Aufgabe selbst und ihre Schritte', () => {
    const self = task({ id: 'self', title: 'Selbst', pinnedAsProject: true });
    const step = task({ id: 'step', title: 'Teil', parentId: 'self', pinnedAsProject: true });
    const other = task({ id: 'other', title: 'Umzug', pinnedAsProject: true });
    const graph = buildGraph([self, step, other]);
    expect(projectCandidates(graph, self).map((p) => p.id)).toEqual(['other']);
  });

  it('nennt das aktuelle Elternteil auch dann, wenn es kein Projekt ist, alphabetisch', () => {
    const parent = task({ id: 'p', title: 'Zelt' });
    const child = task({ parentId: 'p' });
    const project = task({ id: 'q', title: 'Abstellraum', pinnedAsProject: true });
    const graph = buildGraph([parent, child, project]);
    expect(projectCandidates(graph, child).map((p) => p.id)).toEqual(['q', 'p']);
  });
});
