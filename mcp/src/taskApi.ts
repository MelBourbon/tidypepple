import { captureTask } from '@/data/capture';
import { db } from '@/data/db';
import { deleteTask, ensureContexts, ensureProject, setParent, setStatus, updateTask } from '@/data/repo';
import { engageableTasks } from '@/domain/listQuery';
import { allProjects, buildGraph, isProject, selfAndDescendantIds, type TaskGraph } from '@/domain/projects';
import { allTags, hasTag, tagKey, withTag, withoutTag } from '@/domain/tags';
import { isLive, isOpen, type Context, type Task, type TaskStatus } from '@/domain/types';
import { uuidv7 } from '@/domain/ids';

/**
 * Was der MCP-Server mit Aufgaben tun kann – ohne MCP, damit es sich gegen das Repository
 * testen lässt. Gelesen und geschrieben wird wie in der App über `src/data/repo.ts`: jede
 * Änderung bekommt ihren HLC-Stempel und landet in der Outbox, die `SyncEngine` schiebt sie
 * hinaus. Für den Server sieht der MCP-Server aus wie ein weiteres Gerät.
 */

/** Eine Aufgabe, wie Skripte und LLMs sie sehen: Namen statt IDs, Zeitpunkte als ISO-Text. */
export interface PublicTask {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  /** Übergeordnete Aufgabe bzw. Projekt. */
  parent: { id: string; title: string } | null;
  isProject: boolean;
  contexts: string[];
  tags: string[];
  dueDate: string | null;
  dueTime: string | null;
  deferDate: string | null;
  reminderAt: string | null;
  waitingFor: string | null;
  highPriority: boolean;
  attachments: { name: string; type: string; size: number }[];
  createdAt: string;
  completedAt: string | null;
  deleted: boolean;
  /** HLC des letzten Schreibvorgangs – ändert sich mit jeder Änderung, egal von welchem Gerät. */
  version: string;
}

export type ListView = 'actionable' | 'open' | 'done';

export interface ListTasksInput {
  view?: ListView | undefined;
  status?: TaskStatus | undefined;
  tag?: string | undefined;
  context?: string | undefined;
  /** ID oder Titel eines Projekts: alle Aufgaben darunter. */
  project?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
}

export interface TaskPatch {
  title?: string | undefined;
  notes?: string | undefined;
  status?: TaskStatus | undefined;
  dueDate?: string | null | undefined;
  dueTime?: string | null | undefined;
  deferDate?: string | null | undefined;
  reminderAt?: string | null | undefined;
  waitingFor?: string | null | undefined;
  highPriority?: boolean | undefined;
  /** Ersetzt alle Tags. */
  tags?: string[] | undefined;
  addTags?: string[] | undefined;
  removeTags?: string[] | undefined;
  /** Kontext-Namen; fehlende werden angelegt. Ersetzt alle Kontexte. */
  contexts?: string[] | undefined;
  /** Projekt-Name (wird bei Bedarf angelegt) oder `null` für keins. */
  project?: string | null | undefined;
}

export class TaskNotFoundError extends Error {
  readonly name = 'TaskNotFoundError';

  constructor(id: string) {
    super(`Aufgabe ${id} nicht gefunden.`);
  }
}

const MAX_LIMIT = 500;

const iso = (millis: number | null): string | null => (millis === null ? null : new Date(millis).toISOString());

const matchesQuery = (task: Task, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  const haystack = `${task.title}\n${task.notes}\n${task.tags.join(' ')}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

interface Snapshot {
  tasks: Task[];
  graph: TaskGraph;
  contextsById: Map<string, Context>;
}

export class TaskApi {
  /**
   * Eigener Zähler für `changesSince`. Der HLC taugt dafür nicht: Eine Änderung, die ein Gerät
   * offline gemacht hat, kommt mit einem älteren Stempel an als das, was dieser Prozess schon
   * gesehen hat – ein Cursor über HLCs übersähe sie.
   */
  private seq = 0;
  private readonly seen = new Map<string, { hlc: string; seq: number }>();
  /** Ein Cursor gilt nur für diesen Prozess; nach einem Neustart beginnt die Zählung neu. */
  private readonly runId = uuidv7().slice(-12);

  constructor(
    /** Nur Aufgaben mit diesem Tag zeigen und bearbeiten (`TIDYPEPPLE_ONLY_TAG`). */
    private readonly onlyTag: string | null = null,
  ) {}

  private visible(task: Task): boolean {
    return this.onlyTag === null || hasTag(task, this.onlyTag);
  }

  private async snapshot(): Promise<Snapshot> {
    const [tasks, contexts] = await Promise.all([db.tasks.toArray(), db.contexts.toArray()]);
    return { tasks, graph: buildGraph(tasks), contextsById: new Map(contexts.map((c) => [c.id, c])) };
  }

  private toPublic(task: Task, snap: Snapshot): PublicTask {
    const parent = task.parentId === null ? undefined : snap.graph.byId.get(task.parentId);
    return {
      id: task.id,
      title: task.title,
      notes: task.notes,
      status: task.status,
      parent: parent === undefined || !isLive(parent) ? null : { id: parent.id, title: parent.title },
      isProject: isProject(snap.graph, task),
      contexts: task.contexts
        .map((id) => snap.contextsById.get(id))
        .filter((c): c is Context => c !== undefined && isLive(c))
        .map((c) => c.name),
      tags: [...task.tags],
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      deferDate: task.deferDate,
      reminderAt: task.reminderAt,
      waitingFor: task.waitingFor,
      highPriority: task.highPriority,
      attachments: task.attachments.map(({ name, type, size }) => ({ name, type, size })),
      createdAt: new Date(task.createdAt).toISOString(),
      completedAt: iso(task.completedAt),
      deleted: !isLive(task),
      version: task.hlc,
    };
  }

  /** Eine lebende, sichtbare Aufgabe – sonst gilt sie als nicht vorhanden. */
  private async requireTask(id: string): Promise<Task> {
    const task = await db.tasks.get(id);
    if (task === undefined || !isLive(task) || !this.visible(task)) throw new TaskNotFoundError(id);
    return task;
  }

  private findProject(snap: Snapshot, ref: string): Task | undefined {
    const byId = snap.graph.byId.get(ref);
    if (byId !== undefined && isLive(byId)) return byId;
    const key = ref.toLowerCase();
    return snap.tasks.find((t) => isLive(t) && t.status !== 'done' && t.title.toLowerCase() === key);
  }

  async listTasks(input: ListTasksInput = {}): Promise<{ tasks: PublicTask[]; total: number }> {
    const snap = await this.snapshot();
    const view = input.view ?? 'open';
    let tasks: readonly Task[] =
      view === 'actionable'
        ? engageableTasks(snap.graph)
        : snap.tasks.filter((t) => isLive(t) && (view === 'done' ? t.status === 'done' : isOpen(t)));

    tasks = tasks.filter((t) => this.visible(t));
    if (input.status !== undefined) tasks = tasks.filter((t) => t.status === input.status);
    if (input.tag !== undefined) {
      const tag = input.tag.replace(/^#/, '');
      tasks = tasks.filter((t) => hasTag(t, tag));
    }
    if (input.context !== undefined) {
      const key = input.context.replace(/^@/, '').toLowerCase();
      const ids = new Set([...snap.contextsById.values()].filter((c) => isLive(c) && c.name.toLowerCase() === key).map((c) => c.id));
      tasks = tasks.filter((t) => t.contexts.some((c) => ids.has(c)));
    }
    if (input.project !== undefined) {
      const project = this.findProject(snap, input.project.replace(/^\+/, ''));
      const below = project === undefined ? new Set<string>() : selfAndDescendantIds(snap.graph, project.id);
      tasks = tasks.filter((t) => t.id !== project?.id && below.has(t.id));
    }
    if (input.query !== undefined && input.query.trim() !== '') {
      const query = input.query;
      tasks = tasks.filter((t) => matchesQuery(t, query));
    }

    // Stabil und nachvollziehbar: Wichtiges zuerst, dann nach Fälligkeit, dann nach Anlage.
    const sorted = [...tasks].sort(
      (a, b) =>
        Number(b.highPriority) - Number(a.highPriority) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.createdAt - b.createdAt,
    );
    const limit = Math.min(Math.max(input.limit ?? 100, 1), MAX_LIMIT);
    return { tasks: sorted.slice(0, limit).map((t) => this.toPublic(t, snap)), total: sorted.length };
  }

  async getTask(id: string): Promise<{ task: PublicTask; steps: PublicTask[] }> {
    const task = await this.requireTask(id);
    const snap = await this.snapshot();
    const steps = (snap.graph.childrenOf.get(task.id) ?? []).filter((t) => isLive(t) && this.visible(t));
    return { task: this.toPublic(task, snap), steps: steps.map((s) => this.toPublic(s, snap)) };
  }

  async listProjects(): Promise<{ projects: (PublicTask & { openSteps: number })[] }> {
    const snap = await this.snapshot();
    const projects = allProjects(snap.graph).filter((p) => isOpen(p) && this.visible(p));
    return {
      projects: projects.map((p) => ({
        ...this.toPublic(p, snap),
        openSteps: (snap.graph.childrenOf.get(p.id) ?? []).filter(isOpen).length,
      })),
    };
  }

  async listContexts(): Promise<{ contexts: { name: string; openTasks: number }[] }> {
    const snap = await this.snapshot();
    const open = snap.tasks.filter((t) => isOpen(t) && this.visible(t));
    const contexts = [...snap.contextsById.values()].filter(isLive).sort((a, b) => a.order.localeCompare(b.order));
    return {
      contexts: contexts.map((c) => ({ name: c.name, openTasks: open.filter((t) => t.contexts.includes(c.id)).length })),
    };
  }

  async listTags(): Promise<{ tags: { name: string; openTasks: number }[] }> {
    const snap = await this.snapshot();
    const visible = snap.tasks.filter((t) => this.visible(t));
    const open = visible.filter(isOpen);
    return {
      tags: allTags(visible).map((name) => ({ name, openTasks: open.filter((t) => hasTag(t, name)).length })),
    };
  }

  /**
   * Nach jedem Sync und jedem Schreiben aufrufen: vermerkt, welche Aufgaben sich seit dem
   * letzten Mal geändert haben – gleich, ob hier oder auf einem anderen Gerät.
   */
  async trackChanges(): Promise<void> {
    for (const task of await db.tasks.toArray()) {
      if (this.seen.get(task.id)?.hlc === task.hlc) continue;
      this.seq += 1;
      this.seen.set(task.id, { hlc: task.hlc, seq: this.seq });
    }
  }

  /**
   * Was sich seit `cursor` geändert hat, gelöschte Aufgaben eingeschlossen. Ohne oder mit
   * fremdem Cursor (etwa nach einem Neustart des Servers) kommt alles, mit `reset: true`.
   */
  async changesSince(
    cursor: string | undefined,
    limit = MAX_LIMIT,
  ): Promise<{ tasks: PublicTask[]; cursor: string; hasMore: boolean; reset: boolean }> {
    const [runId, seqText] = (cursor ?? '').split(':');
    const reset = runId !== this.runId;
    const since = reset ? 0 : Number(seqText) || 0;

    const snap = await this.snapshot();
    const changed = snap.tasks
      .filter((t) => this.visible(t))
      .map((t) => ({ task: t, seq: this.seen.get(t.id)?.seq ?? 0 }))
      .filter(({ seq }) => seq > since)
      .sort((a, b) => a.seq - b.seq);
    const page = changed.slice(0, Math.min(Math.max(limit, 1), MAX_LIMIT));
    const last = page.at(-1)?.seq ?? since;
    return {
      tasks: page.map(({ task }) => this.toPublic(task, snap)),
      cursor: `${this.runId}:${last}`,
      hasMore: changed.length > page.length,
      reset,
    };
  }

  /** Erfassen in Quick-Add-Syntax wie in der App: `Titel @kontext +projekt #tag !morgen !!`. */
  async addTask(text: string, notes?: string): Promise<{ task: PublicTask }> {
    const result = await captureTask(text);
    if (result === null) throw new Error('Kein Titel erkannt.');
    const extra: Partial<Task> = {};
    if (notes !== undefined && notes !== '') extra.notes = notes;
    // Sonst verschwände die neue Aufgabe sofort aus der eigenen Sicht.
    if (this.onlyTag !== null && !hasTag(result.task, this.onlyTag)) extra.tags = withTag(result.task.tags, this.onlyTag);
    if (Object.keys(extra).length > 0) await updateTask(result.task.id, extra);
    return this.getTask(result.task.id).then(({ task }) => ({ task }));
  }

  async updateTask(id: string, patch: TaskPatch): Promise<{ task: PublicTask }> {
    const task = await this.requireTask(id);
    const changes: Partial<Omit<Task, 'id' | 'createdAt' | 'hlc'>> = {};

    if (patch.title !== undefined) {
      if (patch.title.trim() === '') throw new Error('Der Titel darf nicht leer sein.');
      changes.title = patch.title.trim();
    }
    if (patch.notes !== undefined) changes.notes = patch.notes;
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.dueDate !== undefined) changes.dueDate = patch.dueDate;
    if (patch.dueTime !== undefined) changes.dueTime = patch.dueTime;
    if (patch.deferDate !== undefined) changes.deferDate = patch.deferDate;
    if (patch.reminderAt !== undefined) changes.reminderAt = patch.reminderAt;
    if (patch.waitingFor !== undefined) changes.waitingFor = patch.waitingFor;
    if (patch.highPriority !== undefined) changes.highPriority = patch.highPriority;

    if (patch.tags !== undefined || patch.addTags !== undefined || patch.removeTags !== undefined) {
      let tags = patch.tags === undefined ? [...task.tags] : patch.tags.reduce<string[]>((acc, t) => withTag(acc, t), []);
      for (const t of patch.addTags ?? []) tags = withTag(tags, t);
      for (const t of patch.removeTags ?? []) tags = withoutTag(tags, t.replace(/^#/, ''));
      // Die Sicht-Grenze lässt sich nicht von innen entfernen.
      if (this.onlyTag !== null && !tags.some((t) => tagKey(t) === tagKey(this.onlyTag ?? ''))) {
        tags = withTag(tags, this.onlyTag);
      }
      changes.tags = tags;
    }
    if (patch.contexts !== undefined) {
      changes.contexts = await ensureContexts(patch.contexts.map((c) => c.replace(/^@/, '').trim()).filter((c) => c !== ''));
    }

    if (Object.keys(changes).length > 0) await updateTask(id, changes);

    if (patch.project !== undefined) {
      const parentId = patch.project === null ? null : (await ensureProject(patch.project.replace(/^\+/, '').trim())).id;
      if (!(await setParent(id, parentId))) throw new Error('Eine Aufgabe kann nicht unter sich selbst stehen.');
    }

    return this.getTask(id).then(({ task: updated }) => ({ task: updated }));
  }

  async completeTask(id: string): Promise<{ task: PublicTask }> {
    await this.requireTask(id);
    await setStatus(id, 'done');
    return this.getTask(id).then(({ task }) => ({ task }));
  }

  async reopenTask(id: string): Promise<{ task: PublicTask }> {
    await this.requireTask(id);
    await setStatus(id, 'next');
    return this.getTask(id).then(({ task }) => ({ task }));
  }

  /** Löscht samt Schritten, wie in der App. */
  async deleteTask(id: string): Promise<{ deletedIds: string[] }> {
    await this.requireTask(id);
    return { deletedIds: [...(await deleteTask(id))] };
  }
}
