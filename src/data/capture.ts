import { addStep, createTask, ensureContexts, ensureProject, type ProjectScope } from './repo';
import { captureDestination, parseQuickAdd } from '@/domain/quickAdd';
import { withTag } from '@/domain/tags';
import type { Task } from '@/domain/types';

export interface CaptureResult {
  task: Task;
  /** Das Projekt, falls es durch diese Erfassung erst zum Projekt geworden ist. */
  promoted: Task | null;
}

/**
 * Erfassen in Quick-Add-Syntax – aus dem Eingabefeld der App wie über den MCP-Server.
 *
 * Zwei bewusste Entscheidungen: `+projekt` legt ein fehlendes Projekt an, statt den
 * Erfassungsfluss mit einer Rückfrage zu unterbrechen. Und: wer beim Erfassen schon
 * Kontext oder Datum angibt, hat die Aufgabe bereits geklärt – sie geht direkt in die
 * Liste statt noch einmal durch die Inbox.
 *
 * `null`, wenn nach dem Parsen kein Titel übrig bleibt.
 */
export async function captureTask(input: string, scope: ProjectScope = {}): Promise<CaptureResult | null> {
  const parsed = parseQuickAdd(input);
  if (parsed.title === '') return null;

  const contextIds = await ensureContexts(parsed.contextNames);
  const draft = {
    title: parsed.title,
    contexts: contextIds,
    tags: (scope.tags ?? []).reduce((acc, tag) => withTag(acc, tag), [...parsed.tagNames]),
    dueDate: parsed.dueDate,
    deferDate: parsed.deferDate,
    highPriority: parsed.highPriority,
    status: captureDestination(parsed) === 'inbox' ? ('inbox' as const) : ('next' as const),
  };

  if (parsed.projectName === null) return { task: await createTask(draft), promoted: null };

  const project = await ensureProject(parsed.projectName, scope);
  const { step, promoted } = await addStep(project.id, { ...draft, status: 'next' });
  return { task: step, promoted: promoted ? project : null };
}
