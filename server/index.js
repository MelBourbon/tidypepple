/**
 * Statischer Server für den gebauten PWA-Build.
 *
 * Zwei Zuhörer auf einmal, weil beide gebraucht werden:
 *   HTTP  – schnell im LAN aufrufbar, ohne Zertifikatswarnung
 *   HTTPS – Service Worker und "Zum Homescreen hinzufügen" verlangen einen
 *           "secure context". Über eine LAN-IP per HTTP registriert sich der
 *           Service Worker nicht, Offline-Betrieb wäre also nicht testbar.
 *
 * Bewusst ohne Abhängigkeiten: die App braucht keinen Server, dieser hier ist
 * reine Testinfrastruktur.
 */

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { stat } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.env.ROOT ?? 'dist');
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 5175);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 5176);
const CERT_DIR = resolve(process.env.CERT_DIR ?? 'server/certs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

async function resolveFile(urlPath) {
  // `normalize` nach dem Dekodieren: sonst käme man mit %2e%2e aus dem Root heraus.
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (!candidate.startsWith(ROOT)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    // Datei gibt es nicht – unten folgt der SPA-Fallback.
  }
  return null;
}

async function handle(req, res) {
  // Das CA-Zertifikat kommt aus dem Zertifikatsordner, nicht aus dem Build: sonst wäre
  // es nach dem nächsten `npm run build` weg oder veraltet. Es ist öffentlich –
  // geheim ist nur der zugehörige Schlüssel.
  if ((req.url ?? '').split('?')[0] === '/ca.crt') {
    try {
      const ca = readFileSync(join(CERT_DIR, 'ca.pem'));
      // Dieser MIME-Typ bringt iOS dazu, die Datei als Profil zum Installieren anzubieten.
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.setHeader('Content-Disposition', 'attachment; filename="tidypepple-ca.crt"');
      res.end(ca);
    } catch {
      res.statusCode = 404;
      res.end('Kein CA-Zertifikat hinterlegt');
    }
    return;
  }

  // Nutzungs-Ping: in Produktion protokolliert nginx ihn. Hier nur beantworten,
  // sonst käme der SPA-Fallback mit index.html zurück.
  if ((req.url ?? '').split('?')[0] === '/beacon') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const file = (await resolveFile(req.url ?? '/')) ?? join(ROOT, 'index.html');
  const ext = extname(file);

  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  // Der Service Worker darf nie aus dem Cache kommen, sonst bleibt ein Update hängen.
  res.setHeader(
    'Cache-Control',
    file.endsWith('sw.js') || ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  );

  createReadStream(file)
    .on('error', () => {
      res.statusCode = 404;
      res.end('Nicht gefunden');
    })
    .pipe(res);
}

createHttpServer(handle).listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`HTTP  http://0.0.0.0:${HTTP_PORT}`);
});

try {
  const options = {
    key: readFileSync(join(CERT_DIR, 'key.pem')),
    cert: readFileSync(join(CERT_DIR, 'cert.pem')),
  };
  createHttpsServer(options, handle).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`HTTPS https://0.0.0.0:${HTTPS_PORT}`);
  });
} catch (cause) {
  // Ohne Zertifikat läuft der HTTP-Teil trotzdem weiter – nur die PWA-Funktionen fehlen.
  console.warn(`HTTPS deaktiviert (kein Zertifikat in ${CERT_DIR}): ${cause.message}`);
}

