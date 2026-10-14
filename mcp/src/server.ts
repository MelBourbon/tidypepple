import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { TaskApi } from './taskApi';
import { TASK_STATUSES } from '@/domain/types';

/**
 * Die MCP-Werkzeuge. Sie sind zugleich die öffentliche API für Skripte: Jedes Werkzeug hat
 * ein festes `outputSchema` und liefert `structuredContent`, damit niemand Text parsen muss.
 * Namen und Felder ändern sich deshalb nur additiv.
 */

export const SERVER_NAME = 'tidypepple';

const status = z.enum(TASK_STATUSES);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm');
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:mm');
const taskId = z.string().min(1).describe('ID der Aufgabe, wie list_tasks sie liefert');

const publicTask = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  status,
  parent: z.object({ id: z.string(), title: z.string() }).nullable(),
  isProject: z.boolean(),
  contexts: z.array(z.string()),
  tags: z.array(z.string()),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  deferDate: z.string().nullable(),
  reminderAt: z.string().nullable(),
  waitingFor: z.string().nullable(),
  highPriority: z.boolean(),
  attachments: z.array(z.object({ name: z.string(), type: z.string(), size: z.number() })),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  deleted: z.boolean(),
  version: z.string(),
});

const taskResult = { task: publicTask };

export interface ServerHooks {
  /** Vor jedem lesenden Werkzeug: den Stand vom Server holen (gedrosselt). */
  beforeRead: () => Promise<void>;
  /** Nach jedem schreibenden Werkzeug: die Änderung sofort hinausschieben. */
  afterWrite: () => Promise<void>;
}

const ok = (value: Record<string, unknown>): CallToolResult => ({
  // Text für Clients ohne `structuredContent` – derselbe Inhalt.
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

export function createServer(api: TaskApi, options: { writable: boolean; version: string }, hooks: ServerHooks): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    {
      instructions:
        'TidyPepple ist eine GTD-Aufgabenliste. Status: inbox (ungeklärt), next (handlungsbereit), ' +
        'waiting, scheduled, someday, done. Eine Aufgabe mit Schritten ist ein Projekt. ' +
        'add_task versteht die Erfassungs-Syntax: "Titel @kontext +projekt #tag !morgen >mo !!" ' +
        '(! fällig, > zurückgestellt bis, !! wichtig).',
    },
  );

  const read = <A, R extends Record<string, unknown>>(fn: (args: A) => Promise<R>) =>
    async (args: A): Promise<CallToolResult> => {
      await hooks.beforeRead();
      return ok(await fn(args));
    };
  const write = <A, R extends Record<string, unknown>>(fn: (args: A) => Promise<R>) =>
    async (args: A): Promise<CallToolResult> => {
      await hooks.beforeRead();
      const result = await fn(args);
      await hooks.afterWrite();
      return ok(result);
    };

  server.registerTool(
    'list_tasks',
    {
      title: 'Aufgaben auflisten',
      description:
        'Listet Aufgaben. view: "actionable" = was jetzt getan werden kann (Next-Ansicht, je Projekt nur der ' +
        'nächste Schritt), "open" = alle offenen (Standard), "done" = erledigte. Filter lassen sich kombinieren.',
      inputSchema: {
        view: z.enum(['actionable', 'open', 'done']).optional(),
        status: status.optional(),
        tag: z.string().optional().describe('Tag-Name, mit oder ohne #'),
        context: z.string().optional().describe('Kontext-Name, mit oder ohne @'),
        project: z.string().optional().describe('ID oder Titel eines Projekts: alle Aufgaben darunter'),
        query: z.string().optional().describe('Volltext über Titel, Notizen und Tags'),
        limit: z.number().int().min(1).max(500).optional().describe('Standard 100'),
      },
      outputSchema: { tasks: z.array(publicTask), total: z.number() },
      annotations: { readOnlyHint: true },
    },
    read((args) => api.listTasks(args)),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Aufgabe lesen',
      description: 'Eine Aufgabe mit ihren Schritten.',
      inputSchema: { id: taskId },
      outputSchema: { task: publicTask, steps: z.array(publicTask) },
      annotations: { readOnlyHint: true },
    },
    read(({ id }: { id: string }) => api.getTask(id)),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'Projekte auflisten',
      description: 'Alle offenen Projekte mit der Zahl ihrer offenen Schritte.',
      outputSchema: { projects: z.array(publicTask.extend({ openSteps: z.number() })) },
      annotations: { readOnlyHint: true },
    },
    read(() => api.listProjects()),
  );

  server.registerTool(
    'list_contexts',
    {
      title: 'Kontexte auflisten',
      description: 'Alle Kontexte (@telefon, @büro …) mit der Zahl offener Aufgaben.',
      outputSchema: { contexts: z.array(z.object({ name: z.string(), openTasks: z.number() })) },
      annotations: { readOnlyHint: true },
    },
    read(() => api.listContexts()),
  );

  server.registerTool(
    'list_tags',
    {
      title: 'Tags auflisten',
      description: 'Alle Tags mit der Zahl offener Aufgaben.',
      outputSchema: { tags: z.array(z.object({ name: z.string(), openTasks: z.number() })) },
      annotations: { readOnlyHint: true },
    },
    read(() => api.listTags()),
  );

  server.registerTool(
    'changes_since',
    {
      title: 'Änderungen seit',
      description:
        'Für Sync-Skripte: alle Aufgaben, die sich seit `cursor` geändert haben – auch auf anderen Geräten, ' +
        'gelöschte eingeschlossen (deleted: true). Den gelieferten cursor beim nächsten Aufruf mitgeben. ' +
        'reset: true heißt, der Cursor galt nicht mehr (etwa nach einem Neustart des Servers) und es kommt alles.',
      inputSchema: {
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      outputSchema: { tasks: z.array(publicTask), cursor: z.string(), hasMore: z.boolean(), reset: z.boolean() },
      annotations: { readOnlyHint: true },
    },
    read(({ cursor, limit }: { cursor?: string | undefined; limit?: number | undefined }) =>
      api.changesSince(cursor, limit),
    ),
  );

  // Ein Lese-Token bekommt die schreibenden Werkzeuge gar nicht erst zu sehen.
  if (!options.writable) return server;

  server.registerTool(
    'add_task',
    {
      title: 'Aufgabe erfassen',
      description:
        'Erfasst eine Aufgabe in der Erfassungs-Syntax der App: "Bob anrufen @telefon +Umzug #privat !morgen >mo !!". ' +
        '@ Kontext, + Projekt (wird bei Bedarf angelegt), # Tag, ! fällig, > zurückgestellt bis, !! wichtig. ' +
        'Daten: heute, morgen, mo…so, +3, 2026-10-01, 1.10. Ohne Kontext und Datum landet sie in der Inbox.',
      inputSchema: {
        text: z.string().min(1),
        notes: z.string().optional(),
      },
      outputSchema: taskResult,
    },
    write(({ text, notes }: { text: string; notes?: string | undefined }) => api.addTask(text, notes)),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Aufgabe ändern',
      description:
        'Ändert einzelne Felder; nicht genannte bleiben. null leert ein Feld. tags/contexts ersetzen die Liste, ' +
        'addTags/removeTags ändern sie. project: Projekt-Name (wird angelegt, falls es fehlt) oder null.',
      inputSchema: {
        id: taskId,
        title: z.string().optional(),
        notes: z.string().optional(),
        status: status.optional(),
        dueDate: isoDate.nullable().optional(),
        dueTime: time.nullable().optional(),
        deferDate: isoDate.nullable().optional(),
        reminderAt: localDateTime.nullable().optional(),
        waitingFor: z.string().nullable().optional(),
        highPriority: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
        contexts: z.array(z.string()).optional(),
        project: z.string().nullable().optional(),
      },
      outputSchema: taskResult,
    },
    write(({ id, ...patch }: { id: string } & Parameters<TaskApi['updateTask']>[1]) => api.updateTask(id, patch)),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Aufgabe erledigen',
      inputSchema: { id: taskId },
      outputSchema: taskResult,
      annotations: { idempotentHint: true },
    },
    write(({ id }: { id: string }) => api.completeTask(id)),
  );

  server.registerTool(
    'reopen_task',
    {
      title: 'Aufgabe wieder öffnen',
      description: 'Setzt eine erledigte Aufgabe zurück auf next.',
      inputSchema: { id: taskId },
      outputSchema: taskResult,
      annotations: { idempotentHint: true },
    },
    write(({ id }: { id: string }) => api.reopenTask(id)),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Aufgabe löschen',
      description: 'Löscht eine Aufgabe samt ihrer Schritte.',
      inputSchema: { id: taskId },
      outputSchema: { deletedIds: z.array(z.string()) },
      annotations: { destructiveHint: true },
    },
    write(({ id }: { id: string }) => api.deleteTask(id)),
  );

  return server;
}
