/**
 * Rendert die PNG-Icons aus `public/favicon.svg`. Einmalig nach einer Änderung
 * am SVG ausführen: `node scripts/render-icons.mjs`. Nutzt das Chromium von Playwright,
 * damit kein Bildwerkzeug installiert sein muss.
 *
 * Hintergrund: Die „any“-Icons sind transparent, sonst zeigt die Desktop-PWA ein
 * weißes Quadrat. Maskable und Apple-Touch-Icon brauchen eine deckende Fläche – Android und
 * iOS runden sie selbst. Dafür das warme Grau der App statt reinem Weiß.
 */
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');

// `scale`: Anteil der Kantenlänge. Maskable-Icons schneidet Android bis auf einen Kreis mit
// 80 % Durchmesser zu – der Kiesel muss ganz in diese Safe Zone passen.
const SURFACE = '#faf9f7';
const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 1, background: 'transparent' },
  { file: 'icon-512.png', size: 512, scale: 1, background: 'transparent' },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.9, background: SURFACE },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.7, background: SURFACE },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const { file, size, scale, background } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${background}">
       <div style="width:${size * scale}px;height:${size * scale}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
     </body>`,
  );
  await page.screenshot({
    path: new URL(`../public/${file}`, import.meta.url).pathname,
    omitBackground: background === 'transparent',
  });
  console.log(file);
}
await browser.close();
