import { t } from '@/i18n';

/**
 * Reihenfolge per Knopf statt Drag: die Listen sind kurz, und Knöpfe sind auf dem Handy
 * und mit Tastatur zuverlässiger. Drag & Drop gibt es dort, wo es zählt – im Board.
 *
 * `onMove` bekommt die neuen Nachbarn im Format von `moveTask`/`moveContext`.
 */
export function OrderButtons<T extends { id: string }>({
  items,
  index,
  label,
  onMove,
}: {
  items: readonly T[];
  index: number;
  /** Wie das Element im Namen der Knöpfe heißt, z. B. „Titel“ oder @kontext. */
  label: string;
  onMove: (id: string, target: { afterId: string | null; beforeId: string | null }) => void;
}): React.ReactNode {
  const item = items[index]!;
  const move = (direction: -1 | 1): void => {
    const neighbour = items[index + direction];
    if (neighbour === undefined) return;
    onMove(
      item.id,
      direction === -1
        ? { beforeId: neighbour.id, afterId: items[index - 2]?.id ?? null }
        : { afterId: neighbour.id, beforeId: items[index + 2]?.id ?? null },
    );
  };

  return (
    <span className="flex pr-1">
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={index === 0}
        aria-label={t.order.up(label)}
        className="flex size-8 items-center justify-center text-muted disabled:opacity-25 hover:text-accent"
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        onClick={() => move(1)}
        disabled={index === items.length - 1}
        aria-label={t.order.down(label)}
        className="flex size-8 items-center justify-center text-muted disabled:opacity-25 hover:text-accent"
      >
        <span aria-hidden="true">↓</span>
      </button>
    </span>
  );
}
