import type { Context, Task } from '@/domain/types';

let counter = 0;

/** Minimaler Task-Builder für Tests – nur die Felder setzen, um die es im Test geht. */
export function task(patch: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: `t${counter}`,
    title: `Aufgabe ${counter}`,
    notes: '',
    status: 'next',
    parentId: null,
    order: `a${counter}`,
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
    createdAt: counter,
    deletedAt: null,
    hlc: `00000000000000${counter}:0000:test`,
    ...patch,
  };
}

export function context(patch: Partial<Context> = {}): Context {
  counter += 1;
  return {
    id: `c${counter}`,
    name: `Kontext ${counter}`,
    color: 'slate',
    order: `a${counter}`,
    deletedAt: null,
    hlc: `00000000000000${counter}:0000:test`,
    ...patch,
  };
}

export const resetFactory = (): void => {
  counter = 0;
};
