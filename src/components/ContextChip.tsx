import type { Context } from '@/domain/types';

export function ContextChip({
  context,
  active = false,
  onClick,
}: {
  context: Context;
  active?: boolean;
  onClick?: () => void;
}): React.ReactNode {
  const className = [
    'inline-flex max-w-full shrink-0 items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
    active ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-muted',
  ].join(' ');

  if (onClick === undefined) {
    return (
      <span className={className}>
        <span className="truncate">@{context.name}</span>
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${className} min-h-8 hover:border-line-strong hover:text-ink`}>
      <span className="truncate">@{context.name}</span>
    </button>
  );
}
