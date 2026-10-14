import { useCallback } from 'react';
import { useToast } from './Toast';
import { captureTask } from '@/data/capture';
import {
  addStep,
  completeTask,
  deleteTask,
  deleteTasks,
  reopenTask,
  restoreTasks,
  setProjectPinned,
  undoComplete,
} from '@/data/repo';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Die Aktionen, die Ansichten gemeinsam brauchen – inklusive der Rückmeldung an den
 * Nutzer. Hier sitzt die Undo-Logik, damit keine Ansicht einen Bestätigungsdialog braucht.
 */
export function useTaskActions() {
  const toast = useToast();

  const toggle = useCallback(
    async (task: Task) => {
      if (task.status === 'done') {
        await reopenTask(task.id);
        return;
      }
      await completeTask(task.id);
      toast({ message: t.undo.completed, action: { label: t.undo.action, onClick: () => void undoComplete(task) } });
    },
    [toast],
  );

  const remove = useCallback(
    async (task: Task) => {
      const ids = await deleteTask(task.id);
      toast({ message: t.undo.deleted, action: { label: t.undo.action, onClick: () => void restoreTasks(ids) } });
    },
    [toast],
  );

  const removeMany = useCallback(
    async (tasks: readonly Task[]) => {
      if (tasks.length === 0) return;
      const ids = await deleteTasks(tasks.map((task) => task.id));
      toast({
        message: t.undo.deletedMany(ids.length),
        action: { label: t.undo.action, onClick: () => void restoreTasks(ids) },
      });
    },
    [toast],
  );

  /** Erfassen aus dem Quick-Add-Feld, siehe `captureTask`. */
  const capture = useCallback(
    async (input: string): Promise<Task | null> => {
      const result = await captureTask(input);
      if (result === null) return null;
      if (result.promoted !== null) toast({ message: t.undo.promoted(result.promoted.title) });
      return result.task;
    },
    [toast],
  );

  /** Schritt zu einer Aufgabe hinzufügen; meldet die Beförderung zum Projekt. */
  const addStepTo = useCallback(
    async (parent: Task, title: string) => {
      if (title.trim() === '') return;
      const { promoted } = await addStep(parent.id, { title: title.trim(), status: 'next' });
      if (promoted) {
        toast({
          message: t.undo.promoted(parent.title),
          action: { label: t.undo.action, onClick: () => void setProjectPinned(parent.id, false) },
        });
      }
    },
    [toast],
  );

  return { toggle, remove, removeMany, capture, addStepTo };
}
