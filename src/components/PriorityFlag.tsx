/** Das Zeichen für hohe Priorität – überall dasselbe, damit es in Liste, Board und Detail wiedererkannt wird. */
export function PriorityFlag({ className = 'size-3.5' }: { className?: string }): React.ReactNode {
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0`} fill="currentColor" aria-hidden="true">
      <path d="M3.5 1.75a.75.75 0 0 1 .75.75v.3l1.4-.35a5.5 5.5 0 0 1 3.4.25l.3.12a4 4 0 0 0 2.6.15l.9-.25A.75.75 0 0 1 13.8 3.4v6.2a.75.75 0 0 1-.55.72l-1.14.32a5.5 5.5 0 0 1-3.57-.2l-.3-.13a4 4 0 0 0-2.47-.18l-1.52.38v3.97a.75.75 0 0 1-1.5 0V2.5a.75.75 0 0 1 .75-.75" />
    </svg>
  );
}
