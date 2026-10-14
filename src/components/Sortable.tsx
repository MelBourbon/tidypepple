import { createContext, useContext } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { t } from '@/i18n';

/**
 * Senkrechte Liste zum Umsortieren per Griff. Gezogen wird nur am Griff, nicht an der ganzen
 * Zeile: so bleibt Wischen auf dem Handy Scrollen, und die Zeile bleibt ein Link.
 * Mit der Tastatur: Griff fokussieren, Leertaste, Pfeiltasten, Leertaste.
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: readonly string[];
  onReorder: (from: number, to: number) => void;
  children: React.ReactNode;
}): React.ReactNode {
  const sensors = useSensors(
    // Der Griff hat `touch-action: none` – ein kurzer Weg genügt, auch auf dem Handy.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over === null || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) onReorder(from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

interface HandleProps {
  setRef: (element: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

const HandleContext = createContext<HandleProps | null>(null);

/** Ein `<li>`, das sich in einer `SortableList` verschieben lässt; den Griff setzt `DragHandle`. */
export function SortableItem({
  id,
  className = '',
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}): React.ReactNode {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={[className, isDragging ? 'relative z-20 shadow-menu' : ''].join(' ')}
    >
      <HandleContext.Provider value={{ setRef: setActivatorNodeRef, attributes, listeners }}>{children}</HandleContext.Provider>
    </li>
  );
}

/**
 * Der Griff. Unauffällig: auf Geräten mit Maus erst beim Überfahren der Zeile sichtbar,
 * auf Touch-Geräten immer, aber blass. Außerhalb eines `SortableItem` rendert er nichts.
 */
export function DragHandle({ label }: { label: string }): React.ReactNode {
  const handle = useContext(HandleContext);
  if (handle === null) return null;
  return (
    <button
      type="button"
      ref={handle.setRef}
      {...handle.attributes}
      {...handle.listeners}
      aria-label={t.order.drag(label)}
      title={t.order.drag(label)}
      className="relative z-10 flex size-11 shrink-0 cursor-grab touch-none items-center justify-center text-subtle transition-opacity hover:text-ink focus-visible:opacity-100 active:cursor-grabbing [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
    >
      {/* Lucide „grip-vertical", ISC-Lizenz */}
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="5" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="15" cy="5" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="15" cy="19" r="1.5" />
      </svg>
    </button>
  );
}
