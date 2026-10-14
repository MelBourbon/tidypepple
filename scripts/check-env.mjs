#!/usr/bin/env node
/**
 * Vorab-Prüfung der `.env`, ohne zu bauen: `npm run check:env`.
 *
 * Gedacht für den Moment nach dem Deployment, in dem die Variablen gerade eingetragen
 * wurden – die Antwort kommt sofort, statt erst nach einem vollen Build.
 *
 * Gelesen wird mit `loadEnv` von Vite, damit hier genau dieselben Dateien und dieselbe
 * Vorrangordnung gelten wie beim Build (`.env`, `.env.local`, `.env.<mode>`, …). Eine
 * eigene Parser-Nachbildung könnte grün melden, während der Build etwas anderes sieht.
 */

import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { checkEnv, formatReport, hasErrors } from './env-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv[2] ?? 'production';

const report = checkEnv(loadEnv(mode, root));

console.log(`TidyPepple – Konfiguration für Modus "${mode}":\n`);
console.log(formatReport(report));

if (hasErrors(report)) {
  console.error('\nDer Build würde mit diesen Werten abbrechen.');
  process.exit(1);
}
