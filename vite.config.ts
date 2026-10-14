import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { checkEnv, formatReport, hasErrors } from './scripts/env-check.mjs';

/**
 * Meldet beim Bauen, gegen welches Supabase-Projekt gebaut wird, und bricht bei einer
 * unbrauchbaren Konfiguration ab.
 *
 * Der Grund steht in scripts/env-check.mjs: `VITE_*` wird eingebacken, nicht zur Laufzeit
 * gelesen. Ein Tippfehler in `.env` ergäbe sonst ein Bundle, in dem die Synchronisation
 * lautlos fehlt – bemerkt erst im Browser, nach dem Deployment.
 */
const envGuard = (): Plugin => ({
  name: 'tidypepple:env-guard',
  // `config.env` ist genau das, was als `import.meta.env` im Bundle landet. Deshalb wird
  // hier das Ergebnis geprüft und nicht die `.env` ein zweites Mal eingelesen.
  configResolved(config) {
    const report = checkEnv(config.env);
    config.logger.info('\n' + formatReport(report) + '\n');
    if (hasErrors(report)) {
      throw new Error('Unbrauchbare Konfiguration, siehe oben. Vorlage: .env.example');
    }
  },
});

/**
 * Version für das Beacon. `package.json` wird nicht gepflegt, die Git-Tags
 * dagegen schon. Zwischen zwei Tags steht der Abstand dabei (`v0.9.0-3-gabc1234`).
 */
const appVersion = ((): string => {
  try {
    return execSync('git describe --tags --always', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    envGuard(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // `/stats/` (Nutzungs-Dashboard, separat betrieben) liegt auf derselben Domain, gehört aber nicht zur App.
        // Ebenso die Downloads (MCP-Erweiterung): ein Link darauf ist eine Navigation, und der
        // Service Worker lieferte sonst die App statt der Datei.
        navigateFallbackDenylist: [/^\/stats(\/|$)/, /^\/downloads\//],
        // Klick auf eine Erinnerung öffnet die Aufgabe (src/platform/notifications.ts).
        importScripts: ['notification-click.js'],
      },
      manifest: {
        name: 'TidyPepple',
        short_name: 'TidyPepple',
        description: 'Minimalistisches GTD – offline-first und Ende-zu-Ende verschlüsselt.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf9f7',
        theme_color: '#faf9f7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Android-Teilen-Menü. GET reicht für Text und Links und braucht keinen
        // Code im Service Worker; Dateien bräuchten POST. Nur Chromium-Browser, nur installiert.
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        shortcuts: [
          { name: 'Schnell erfassen', url: '/?capture=1' },
          { name: 'Inbox', url: '/inbox' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
