import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { checkEnv, formatReport, hasErrors } from '../scripts/env-check.mjs';

/**
 * Baut den MCP-Server zu einer einzigen Datei `mcp/dist/server.mjs`, alle Abhängigkeiten
 * eingebunden. Dieselbe Datei steckt in der Claude-Desktop-Erweiterung und im npm-Paket –
 * beide brauchen so keine `node_modules`.
 *
 * Supabase-Adresse und Anon-Key kommen wie bei der App aus `.env` im Projektverzeichnis
 * und werden eingebacken. Ohne sie läuft der Server nur mit TIDYPEPPLE_SUPABASE_URL/_ANON_KEY.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Wie in der App: eine unbrauchbare Konfiguration bricht den Build ab, statt lautlos zu fehlen. */
const envGuard = (): Plugin => ({
  name: 'tidypepple:mcp-env-guard',
  configResolved(config) {
    const report = checkEnv(config.env);
    config.logger.info('\n' + formatReport(report) + '\n');
    if (hasErrors(report)) throw new Error('Unbrauchbare Konfiguration, siehe oben. Vorlage: .env.example');
  },
});

export default defineConfig({
  root,
  envDir: root,
  // Die Icons und Skripte der App gehören nicht in den Server.
  publicDir: false,
  plugins: [envGuard()],
  define: { __MCP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  ssr: {
    // Alles einbinden: Die Erweiterung und das npm-Paket bringen keine node_modules mit.
    noExternal: true,
    target: 'node',
  },
  build: {
    ssr: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'server.mjs',
        format: 'es',
        banner: '#!/usr/bin/env node',
        codeSplitting: false,
      },
    },
  },
});
