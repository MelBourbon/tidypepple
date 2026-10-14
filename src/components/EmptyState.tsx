/**
 * Leere Zustände erklären den Workflow, statt nur "keine Daten" zu melden – für eine
 * Methode wie GTD ist das der einzige Ort, an dem Anleitung nicht im Weg steht.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string | undefined }): React.ReactNode {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-heading-14">{title}</p>
      {hint !== undefined && <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{hint}</p>}
    </div>
  );
}
