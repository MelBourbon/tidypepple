import { describe, expect, it } from 'vitest';
import { clarifyPatch, isComplete, nextToClarify, summarize, undoFields } from '@/domain/clarify';
import { task } from './factory';

describe('clarifyPatch', () => {
  it('erledigt, stellt zurück und legt ab', () => {
    expect(clarifyPatch({ kind: 'done' })).toEqual({ status: 'done' });
    expect(clarifyPatch({ kind: 'someday' })).toEqual({ status: 'someday' });
    expect(clarifyPatch({ kind: 'later', deferDate: '2026-11-10' })).toEqual({ status: 'next', deferDate: '2026-11-10' });
    expect(clarifyPatch({ kind: 'delete' })).toBeNull();
  });

  it('übernimmt die Kontextauswahl vollständig – Abgewähltes bleibt weg', () => {
    expect(clarifyPatch({ kind: 'next', contexts: ['c2', 'c2'] })).toEqual({ status: 'next', contexts: ['c2'] });
    expect(clarifyPatch({ kind: 'next', contexts: [] })).toEqual({ status: 'next', contexts: [] });
  });

  it('merkt sich, auf wen gewartet wird – Leerraum zählt nicht', () => {
    expect(clarifyPatch({ kind: 'waiting', waitingFor: '  Bob ' })).toEqual({ status: 'waiting', waitingFor: 'Bob' });
    expect(clarifyPatch({ kind: 'waiting', waitingFor: '  ' })).toEqual({ status: 'waiting', waitingFor: null });
  });

  it('macht ein Projekt daraus', () => {
    expect(clarifyPatch({ kind: 'project', firstStep: 'Kartons' })).toEqual({
      status: 'next',
      pinnedAsProject: true,
    });
  });
});

describe('undoFields', () => {
  it('stellt genau die Felder von vorher her', () => {
    const before = task({ status: 'inbox', contexts: ['c1'], deferDate: null, waitingFor: null });
    expect(undoFields(before)).toEqual({
      status: 'inbox',
      contexts: ['c1'],
      waitingFor: null,
      waitingSince: null,
      deferDate: null,
      completedAt: null,
      pinnedAsProject: false,
      dueDate: null,
      dueTime: null,
      reminderAt: null,
    });
  });
});

describe('isComplete', () => {
  it('verlangt für ein Projekt einen ersten Schritt', () => {
    expect(isComplete({ kind: 'project', firstStep: ' ' })).toBe(false);
    expect(isComplete({ kind: 'project', firstStep: 'Kartons kaufen' })).toBe(true);
    expect(isComplete({ kind: 'waiting', waitingFor: null })).toBe(true);
  });
});

describe('nextToClarify', () => {
  const old = task({ status: 'inbox', createdAt: 1 });
  const mid = task({ status: 'inbox', createdAt: 2 });
  const fresh = task({ status: 'inbox', createdAt: 3 });

  it('nimmt die älteste zuerst', () => {
    expect(nextToClarify([fresh, old, mid], new Set())).toBe(old);
  });

  it('überspringt Übersprungenes und ist am Ende leer', () => {
    expect(nextToClarify([fresh, old, mid], new Set([old.id]))).toBe(mid);
    expect(nextToClarify([old], new Set([old.id]))).toBeNull();
    expect(nextToClarify([], new Set())).toBeNull();
  });
});

describe('summarize', () => {
  it('zählt Entscheidungen in fester Reihenfolge und lässt fehlende weg', () => {
    expect(summarize(['next', 'done', 'next', 'delete'])).toEqual([
      { kind: 'done', count: 1 },
      { kind: 'next', count: 2 },
      { kind: 'delete', count: 1 },
    ]);
  });
});
