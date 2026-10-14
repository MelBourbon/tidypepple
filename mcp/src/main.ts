// Dexie braucht IndexedDB. Hier liegt sie im Speicher: Beim Start holt der Server den ganzen
// Vault neu, und nach dem Beenden bleibt nichts im Klartext auf der Platte zurück.
import 'fake-indexeddb/auto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';
import { TaskApi } from './taskApi';
import { parseApiToken, unwrapVaultKeyWithToken } from '@/crypto/apiToken';
import { initRepo } from '@/data/repo';
import { ApiClient } from '@/sync/api';
import { SyncEngine } from '@/sync/engine';

/**
 * TidyPepple als MCP-Server. Läuft beim Nutzer – als Claude-Desktop-Erweiterung
 * oder über `npx tidypepple-mcp` – und ist ein vollwertiges Gerät mit Vault-Key. Der Server
 * bei Supabase sieht weiterhin nur Ciphertext.
 *
 * Konfiguration über Umgebungsvariablen:
 *   TIDYPEPPLE_TOKEN       API-Token aus der App (Einstellungen → API-Zugriff), Pflicht
 *   TIDYPEPPLE_ONLY_TAG    nur Aufgaben mit diesem Tag zeigen, optional
 *   TIDYPEPPLE_SUPABASE_URL / TIDYPEPPLE_SUPABASE_ANON_KEY
 *                          nur für eigene Installationen; Standard ist der Build-Wert
 *
 * stdout gehört dem Protokoll. Alles für Menschen geht nach stderr.
 */

declare const __MCP_VERSION__: string;

/** Wie lange ein gelesener Stand als frisch gilt, bevor ein Werkzeug neu holt. */
const FRESH_MS = 10_000;

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
};

function fail(message: string): never {
  process.stderr.write(`tidypepple-mcp: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const tokenText = env('TIDYPEPPLE_TOKEN') ?? fail('TIDYPEPPLE_TOKEN fehlt. Ein Token gibt es in der App unter Einstellungen → API-Zugriff.');
  const token = parseApiToken(tokenText) ?? fail('TIDYPEPPLE_TOKEN ist kein gültiges TidyPepple-Token (beginnt mit "tp1.").');

  const url = env('TIDYPEPPLE_SUPABASE_URL') ?? import.meta.env['VITE_SUPABASE_URL'];
  const anonKey = env('TIDYPEPPLE_SUPABASE_ANON_KEY') ?? import.meta.env['VITE_SUPABASE_ANON_KEY'];
  if (typeof url !== 'string' || url === '' || typeof anonKey !== 'string' || anonKey === '') {
    fail('Keine Server-Adresse eingebaut. TIDYPEPPLE_SUPABASE_URL und TIDYPEPPLE_SUPABASE_ANON_KEY setzen.');
  }

  const client = new ApiClient({ url, anonKey }, token);
  const session = await client.session();
  const vaultKey = await unwrapVaultKeyWithToken(session.wrappedVaultKey, token).catch(() =>
    fail('Das Token passt nicht zum Schlüssel auf dem Server – wurde es vollständig kopiert?'),
  );

  await initRepo();
  const engine = new SyncEngine(client.adapter(), {
    key: () => vaultKey,
    keyVersion: () => session.keyVersion,
    vaultId: () => session.vaultId,
  });
  const api = new TaskApi(env('TIDYPEPPLE_ONLY_TAG')?.replace(/^#/, '') ?? null);

  let syncedAt = 0;
  const sync = async (): Promise<boolean> => {
    const result = await engine.syncOnce();
    syncedAt = Date.now();
    await api.trackChanges();
    if (result.undecryptable > 0) {
      process.stderr.write(`tidypepple-mcp: ${result.undecryptable} Einträge ließen sich nicht entschlüsseln.\n`);
    }
    return !result.pushBlocked;
  };

  await sync();

  const server = createServer(
    api,
    { writable: session.scope === 'write', version: __MCP_VERSION__ },
    {
      beforeRead: async () => {
        if (Date.now() - syncedAt > FRESH_MS) await sync();
      },
      afterWrite: async () => {
        // Bleibt die Änderung hier hängen, ginge sie mit dem Prozess verloren – das muss der
        // Aufrufer erfahren, statt ein Erfolg zu sehen.
        if (!(await sync())) {
          throw new Error('Die Änderung wurde nicht hochgeladen: Für die API ist ein aktives Sync-Abo nötig.');
        }
      },
    },
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write(`tidypepple-mcp ${__MCP_VERSION__}: verbunden als „${session.name}“ (${session.scope}).\n`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
