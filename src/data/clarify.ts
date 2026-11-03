import { addStep, deleteTask, deleteTasks, restoreTasks, updateTask } from './repo';
import { clarifyPatch, isComplete, undoFields, type ClarifyDecision } from '@/domain/clarify';
import type { Task } from '@/domain/types';

/**
 * Führt eine Klären-Entscheidung aus und liefert, wie sie sich zurücknehmen lässt – für
 * den Undo-Toast. Kein Bestätigungsdialog: wer sich verklickt, nimmt zurück.
 *
 * `null`, wenn die Entscheidung unvollständig ist (Projekt ohne ersten Schritt).
 */
export async function applyClarify(task: Task, decision: ClarifyDecision): Promise<(() => Promise<void>) | null> {
  if (!isComplete(decision)) return null;

  if (decision.kind === 'delete') {
    const ids = await deleteTask(task.id);
    return () => restoreTasks(ids);
  }

  const before = undoFields(task);
  const patch = clarifyPatch(decision);

  if (decision.kind === 'project') {
    // Erst der Schritt: scheitert er, ist nichts geändert und die Aufgabe liegt weiter in
    // der Inbox. `addStep` befördert sie dabei selbst (Projekt, Inbox → Next); der Patch
    // danach hält das fest, falls sie schon vorher angeheftet war.
    const { step } = await addStep(task.id, { title: decision.firstStep.trim(), status: 'next' });
    if (patch !== null) await updateTask(task.id, patch);
    return async () => {
      await deleteTasks([step.id]);
      await updateTask(task.id, before);
    };
  }

  if (patch !== null) await updateTask(task.id, patch);
  return () => updateTask(task.id, before);
}
