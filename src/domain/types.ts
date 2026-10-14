/**
 * Datenmodell. Bewusst ohne optionale Properties: jedes Feld ist immer vorhanden und
 * darf `null` sein. Das hält Sync-Merges (Feldvergleiche) und `exactOptionalPropertyTypes`
 * einfach – ein fehlendes Feld und ein leeres Feld sind nie zwei verschiedene Zustände.
 */

/** GTD-Status. `inbox` = noch nicht geklärt, `next` = handlungsbereit. */
export const TASK_STATUSES = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Offene Status in Arbeitsreihenfolge – Board-Spalten, Statusfilter und -sortierung der Liste. */
export const OPEN_STATUSES: readonly TaskStatus[] = ['inbox', 'next', 'scheduled', 'waiting', 'someday'];

/** Reihenfolge der Schritte eines Projekts: nur der erste offene, oder alle. */
export type ProjectMode = 'sequential' | 'parallel';

/** ISO-Datum ohne Zeitzone, 'YYYY-MM-DD'. */
export type IsoDate = string;

/**
 * Metadaten eines Anhangs. Sie reisen mit der Aufgabe – verschlüsselt, wie alles
 * andere. Die Datei selbst liegt getrennt in `db.blobs`, damit Listen und Sync nicht mit
 * Megabytes hantieren.
 */
export interface Attachment {
  id: string;
  name: string;
  /** MIME-Typ, z. B. 'image/jpeg' oder 'application/pdf'. */
  type: string;
  /** Größe in Bytes – nach dem Verkleinern, also so, wie sie gespeichert ist. */
  size: number;
  addedAt: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  /** Übergeordnetes Projekt, oder `null` für Aufgaben auf oberster Ebene. */
  parentId: string | null;
  /** Fractional Index – manuelle Reihenfolge und Schrittfolge innerhalb eines Projekts. */
  order: string;
  /**
   * Fractional Index für die manuelle Sortierung der flachen Listen ("Next", "All", Projekte).
   * Getrennt von `order`, damit Umsortieren dort nicht die Schrittfolge eines Projekts ändert.
   * `null`, solange nie von Hand verschoben – solche Aufgaben stehen hinten.
   */
  listOrder: string | null;
  contexts: string[];
  /** Freie Schlagworte, Namen ohne `#`. Siehe `tags.ts`. */
  tags: string[];
  dueDate: IsoDate | null;
  /** 'HH:mm', nur zur Anzeige – die Fälligkeit selbst ist datumsbasiert. */
  dueTime: string | null;
  /** Vor diesem Datum erscheint die Aufgabe nicht in der Liste (Tickler). */
  deferDate: IsoDate | null;
  /**
   * Erinnerung zu einem festen Zeitpunkt, lokale Zeit 'YYYY-MM-DDTHH:mm' ohne Zeitzone –
   * wie `dueDate` gilt sie dort, wo das Gerät gerade ist. Nur von Hand gesetzt, nie automatisch.
   */
  reminderAt: string | null;
  projectMode: ProjectMode;
  /** Explizit zum Projekt befördert, auch ohne offene Schritte. */
  pinnedAsProject: boolean;
  /** Auf wen gewartet wird (nur bei status === 'waiting' relevant). */
  waitingFor: string | null;
  /** Seit wann die Aufgabe wartet (ms) – gesetzt beim Wechsel auf 'waiting', sonst `null`. */
  waitingSince: number | null;
  /** Hohe Priorität – eine Markierung, keine Skala. Mehr Stufen verwässern nur, was wichtig ist. */
  highPriority: boolean;
  attachments: Attachment[];
  completedAt: number | null;
  createdAt: number;
  /** Soft Delete – Tombstone, damit Löschungen sich synchronisieren lassen. */
  deletedAt: number | null;
  /** Hybrid Logical Clock des letzten Schreibvorgangs, für Last-Writer-Wins. */
  hlc: string;
}

export interface Context {
  id: string;
  name: string;
  color: string;
  order: string;
  deletedAt: number | null;
  hlc: string;
}

/** Was ein Task-Entwurf mindestens braucht; alles andere wird mit Defaults gefüllt. */
export type TaskDraft = Partial<Omit<Task, 'id' | 'createdAt' | 'hlc'>> & { title: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const matchOrNull = (value: unknown, pattern: RegExp): string | null =>
  typeof value === 'string' && pattern.test(value) ? value : null;

const normalizeAttachment = (value: unknown): Attachment | null => {
  const a = value as Partial<Attachment> | null;
  if (a === null || typeof a !== 'object' || typeof a.id !== 'string' || a.id === '') return null;
  return {
    id: a.id,
    name: str(a.name, ''),
    type: str(a.type, 'application/octet-stream'),
    size: numOrNull(a.size) ?? 0,
    addedAt: numOrNull(a.addedAt) ?? 0,
  };
};

/**
 * Bringt eine Aufgabe von außen – Sicherung, anderes Gerät, ältere App-Version – in die Form,
 * die der Rest der App voraussetzt. Fehlende oder kaputte Felder bekommen ihren Standardwert;
 * ohne ID oder Titel ist es keine Aufgabe (`null`).
 *
 * Ohne diese Prüfung reichte ein einziges `contexts: null` in einer Sicherung, um jede Liste
 * zum Absturz zu bringen – und über die Outbox auf allen Geräten.
 */
export function normalizeTask(value: unknown): Task | null {
  const t = value as Partial<Record<keyof Task, unknown>> | null;
  if (t === null || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || t.id === '' || typeof t.title !== 'string') return null;
  const parentId = strOrNull(t.parentId);
  return {
    id: t.id,
    title: t.title,
    notes: str(t.notes, ''),
    status: TASK_STATUSES.includes(t.status as TaskStatus) ? (t.status as TaskStatus) : 'inbox',
    // Eine Aufgabe als eigenes Elternteil hinge sonst unerreichbar im Graphen.
    parentId: parentId === t.id || parentId === '' ? null : parentId,
    order: typeof t.order === 'string' && t.order !== '' ? t.order : 'a0',
    listOrder: t.listOrder === '' ? null : strOrNull(t.listOrder),
    contexts: Array.isArray(t.contexts) ? t.contexts.filter((c): c is string => typeof c === 'string') : [],
    tags: Array.isArray(t.tags) ? t.tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '') : [],
    dueDate: matchOrNull(t.dueDate, ISO_DATE),
    dueTime: matchOrNull(t.dueTime, TIME),
    deferDate: matchOrNull(t.deferDate, ISO_DATE),
    reminderAt: matchOrNull(t.reminderAt, LOCAL_DATE_TIME),
    projectMode: t.projectMode === 'parallel' ? 'parallel' : 'sequential',
    pinnedAsProject: t.pinnedAsProject === true,
    waitingFor: strOrNull(t.waitingFor),
    waitingSince: numOrNull(t.waitingSince),
    highPriority: t.highPriority === true,
    attachments: Array.isArray(t.attachments)
      ? t.attachments.map(normalizeAttachment).filter((a): a is Attachment => a !== null)
      : [],
    completedAt: numOrNull(t.completedAt),
    createdAt: numOrNull(t.createdAt) ?? 0,
    deletedAt: numOrNull(t.deletedAt),
    hlc: str(t.hlc, ''),
  };
}

/** Wie `normalizeTask`, für Kontexte. Ohne ID oder Namen `null`. */
export function normalizeContext(value: unknown): Context | null {
  const c = value as Partial<Record<keyof Context, unknown>> | null;
  if (c === null || typeof c !== 'object') return null;
  if (typeof c.id !== 'string' || c.id === '' || typeof c.name !== 'string') return null;
  return {
    id: c.id,
    name: c.name,
    color: str(c.color, 'slate'),
    order: typeof c.order === 'string' && c.order !== '' ? c.order : 'a0',
    deletedAt: numOrNull(c.deletedAt),
    hlc: str(c.hlc, ''),
  };
}

export const isOpen = (t: Task): boolean => t.deletedAt === null && t.status !== 'done';

/** Gilt für jeden Record mit Tombstone – Aufgaben wie Kontexte. */
export const isLive = <T extends { deletedAt: number | null }>(record: T): boolean => record.deletedAt === null;
