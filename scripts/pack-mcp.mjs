#!/usr/bin/env node
/**
 * Packt den gebauten MCP-Server (`mcp/dist/server.mjs`) als Claude-Desktop-Erweiterung:
 * `mcp/tidypepple-<version>.mcpb`. Aufruf über `npm run build:mcp`.
 *
 * Die Version steht nur in `mcp/package.json`; das Manifest bekommt sie hier. So können
 * npm-Paket und Erweiterung nicht auseinanderlaufen.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @param {string} path */
const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const { version } = JSON.parse(readFileSync(at('mcp/package.json'), 'utf8'));
const server = at('mcp/dist/server.mjs');
if (!existsSync(server)) {
  console.error('mcp/dist/server.mjs fehlt – erst `vite build --config mcp/vite.config.ts`.');
  process.exit(1);
}

const stage = at('mcp/.bundle');
rmSync(stage, { recursive: true, force: true });
mkdirSync(`${stage}/server`, { recursive: true });

const manifest = JSON.parse(readFileSync(at('mcp/manifest.json'), 'utf8'));
writeFileSync(`${stage}/manifest.json`, JSON.stringify({ ...manifest, version }, null, 2));
cpSync(server, `${stage}/server/server.mjs`);
cpSync(at('public/icon-512.png'), `${stage}/icon.png`);

const output = at(`mcp/tidypepple-${version}.mcpb`);
execFileSync(process.execPath, [at('node_modules/@anthropic-ai/mcpb/dist/cli/cli.js'), 'pack', stage, output], {
  stdio: 'inherit',
});
rmSync(stage, { recursive: true, force: true });

// Die App bietet die Erweiterung zum Download an (Einstellungen → API-Zugriff). Mit
// demselben `.env` gebaut, zeigt sie auf denselben Server wie die App.
mkdirSync(at('public/downloads'), { recursive: true });
cpSync(output, at('public/downloads/tidypepple.mcpb'));
console.log(`\n✓ ${output}\n✓ public/downloads/tidypepple.mcpb – liegt nach dem nächsten \`npm run build\` neben der App`);
