import { describe, expect, it } from 'vitest';
import { GRACE_MS, hasPendingReminder, pendingReminders, reminderTime } from '@/domain/reminders';
import { normalizeTask } from '@/domain/types';
import { task } from './factory';

const now = new Date(2026, 9, 6, 12, 0).getTime();

describe('reminderTime', () => {
  it('liest lokale Zeit', () => {
    expect(reminderTime('2026-10-06T12:00')).toBe(now);
    expect(reminderTime('2026-10-06')).toBeNaN();
  });
});

describe('pendingReminders', () => {
  it('nimmt nur offene Aufgaben mit künftiger Erinnerung, nach Zeit sortiert', () => {
    const later = task({ title: 'später', reminderAt: '2026-10-07T08:00' });
    const soon = task({ title: 'gleich', reminderAt: '2026-10-06T12:30' });
    const past = task({ reminderAt: '2026-10-06T11:00' });
    const done = task({ status: 'done', reminderAt: '2026-10-06T13:00' });
    const deleted = task({ deletedAt: 1, reminderAt: '2026-10-06T13:00' });
    const none = task();

    expect(pendingReminders([later, soon, past, done, deleted, none], now)).toEqual([
      { id: soon.id, at: '2026-10-06T12:30', title: 'gleich' },
      { id: later.id, at: '2026-10-07T08:00', title: 'später' },
    ]);
  });

  it('holt im Browser gerade Verpasstes nach, Älteres nicht', () => {
    const missed = task({ reminderAt: '2026-10-06T11:55' });
    const old = task({ reminderAt: '2026-10-06T11:00' });
    expect(pendingReminders([missed, old], now - GRACE_MS).map((r) => r.id)).toEqual([missed.id]);
  });
});

describe('hasPendingReminder', () => {
  it('zeigt die Glocke nur vor dem Zeitpunkt', () => {
    expect(hasPendingReminder(task({ reminderAt: '2026-10-06T12:01' }), now)).toBe(true);
    expect(hasPendingReminder(task({ reminderAt: '2026-10-06T11:59' }), now)).toBe(false);
    expect(hasPendingReminder(task(), now)).toBe(false);
  });
});

describe('normalizeTask', () => {
  it('übernimmt nur gültige Erinnerungen', () => {
    expect(normalizeTask({ id: 'a', title: 'x', reminderAt: '2026-10-06T09:30' })?.reminderAt).toBe('2026-10-06T09:30');
    expect(normalizeTask({ id: 'a', title: 'x', reminderAt: '2026-10-06' })?.reminderAt).toBeNull();
    expect(normalizeTask({ id: 'a', title: 'x', reminderAt: 5 })?.reminderAt).toBeNull();
    expect(normalizeTask({ id: 'a', title: 'x' })?.reminderAt).toBeNull();
  });
});
