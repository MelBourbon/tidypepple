/**
 * Prüft die Build-Konfiguration, bevor sie in das Bundle eingebacken wird.
 *
 * Der Anlass ist eine Eigenschaft von Vite, die beim Deployment leicht zur Falle wird:
 * `VITE_*`-Variablen werden beim Bauen eingesetzt, nicht zur Laufzeit gelesen. Fehlt eine
 * oder ist sie vertippt, bricht nichts ab – es entsteht ein Build, in dem die
 * Synchronisation einfach stumm fehlt. Aufgefallen wäre das erst im Browser.
 *
 * Deshalb hier: was eindeutig falsch ist, bricht den Build ab; was nur ungewöhnlich ist,
 * wird gemeldet. Gar keine Konfiguration bleibt dagegen ein gültiger Zustand – die App
 * läuft dann rein lokal, das ist eine Absicht und kein Fehler.
 *
 * Reines Modul ohne Abhängigkeiten: nutzbar aus `vite.config.ts`, aus `npm run check:env`
 * und aus den Unit-Tests.
 */

/** @typedef {{ level: 'error' | 'warn', text: string, fix?: string }} Finding */

/**
 * @typedef {object} EnvReport
 * @property {{ url: string, ref: string | null, host: string } | null} sync
 *   Erkanntes Supabase-Ziel, oder `null` für einen Build ohne Synchronisation.
 * @property {string | null} checkout Erkannte Checkout-Adresse.
 * @property {boolean} beacon Ob die App anonyme Start-Pings an `/beacon` schickt.
 * @property {boolean} playBilling Ob die Android-App Abos über Google Play verkauft.
 * @property {boolean} configured Ob überhaupt Werte gesetzt waren. Trennt „bewusst ohne
 *   Synchronisation gebaut" von „konfiguriert, aber unbrauchbar" – im Log sieht das sonst
 *   gleich aus.
 * @property {Finding[]} findings
 */

export const SUPABASE_URL = 'VITE_SUPABASE_URL';
export const SUPABASE_ANON_KEY = 'VITE_SUPABASE_ANON_KEY';
export const CHECKOUT_URL = 'VITE_LEMONSQUEEZY_CHECKOUT_URL';
export const BEACON = 'VITE_BEACON';
export const PLAY_BILLING = 'VITE_PLAY_BILLING';

/**
 * Die Platzhalter aus `.env.example`. Wer die Vorlage kopiert und nur eine Zeile ersetzt,
 * soll das genau so gesagt bekommen – die Folgefehler („sieht nach keinem Key aus") führen
 * sonst in die falsche Richtung.
 */
const PLACEHOLDERS = new Set([
  'https://your-project.supabase.co',
  'your-anon-key',
  'https://your-store.lemonsqueezy.com/buy/<variant-uuid>',
  // Frühere deutsche Fassung der Vorlage – ältere Kopien sollen weiter erkannt werden.
  'https://dein-projekt.supabase.co',
  'dein-anon-key',
  'https://dein-store.lemonsqueezy.com/buy/<variant-uuid>',
]);

/**
 * Leerstring und fehlender Wert sind gleichbedeutend – eine auskommentierte und eine
 * leer gelassene Zeile in `.env` sollen dasselbe bedeuten.
 *
 * @param {Record<string, unknown>} env
 * @param {string} name
 * @returns {string}
 */
const read = (env, name) => {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * Lokale Supabase-Instanzen (`supabase start`) laufen ohne TLS auf der Loopback-Adresse.
 * Das ist der einzige Fall, in dem `http://` legitim ist.
 *
 * @param {URL} url
 * @returns {boolean}
 */
const isLoopback = (url) =>
  url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';

/**
 * Nutzlast eines JWT lesen, ohne die Signatur zu prüfen. Das genügt hier: die Frage ist
 * nicht, ob der Key echt ist – das beantwortet der Server – sondern ob der *richtige*
 * eingetragen wurde.
 *
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
const jwtPayload = (token) => {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1] === undefined || parts[1] === '') return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? payload : null;
  } catch {
    return null;
  }
};

/**
 * @param {Record<string, unknown>} env
 * @returns {EnvReport}
 */
export function checkEnv(env) {
  /** @type {Finding[]} */
  const findings = [];
  const rawUrl = read(env, SUPABASE_URL);
  const rawKey = read(env, SUPABASE_ANON_KEY);

  /** @type {EnvReport['sync']} */
  let sync = null;
  /** @type {string | null} */
  let urlRef = null;

  // Genau eine der beiden Variablen gesetzt: das ist nie gewollt, sondern immer ein
  // Tippfehler oder eine halb ausgefüllte `.env`. Die App würde stumm lokal laufen.
  if ((rawUrl === '') !== (rawKey === '')) {
    const missing = rawUrl === '' ? SUPABASE_URL : SUPABASE_ANON_KEY;
    findings.push({
      level: 'error',
      text: `${missing} fehlt, die andere Hälfte der Supabase-Konfiguration ist aber gesetzt.`,
      fix: 'Beide Variablen setzen – oder beide leer lassen für einen Build ohne Synchronisation.',
    });
  }

  /** @type {[string, string][]} */
  const entries = [
    [SUPABASE_URL, rawUrl],
    [SUPABASE_ANON_KEY, rawKey],
    [CHECKOUT_URL, read(env, CHECKOUT_URL)],
  ];
  for (const [name, value] of entries) {
    if (PLACEHOLDERS.has(value)) {
      findings.push({
        level: 'error',
        text: `${name} enthält noch den Platzhalter aus .env.example.`,
        fix: 'Den echten Wert eintragen oder die Zeile ganz leeren.',
      });
    }
  }

  if (rawUrl !== '' && !PLACEHOLDERS.has(rawUrl)) {
    let url = null;
    try {
      url = new URL(rawUrl);
    } catch {
      findings.push({
        level: 'error',
        text: `${SUPABASE_URL} ist keine gültige URL: ${rawUrl}`,
        fix: 'Erwartet wird die API-URL aus Project Settings → API, z. B. https://abcdefgh.supabase.co',
      });
    }

    if (url !== null) {
      // Der häufigste Fehlgriff: die Adresse aus der Browserzeile des Dashboards statt
      // der API-URL. Beides enthält die Projekt-Ref, nur eine spricht die API.
      if (url.hostname === 'supabase.com' || url.pathname.includes('/dashboard/project/')) {
        const ref = url.pathname.split('/').filter((s) => s !== '').pop() ?? '<ref>';
        findings.push({
          level: 'error',
          text: `${SUPABASE_URL} zeigt auf das Dashboard, nicht auf die API.`,
          fix: `Stattdessen https://${ref}.supabase.co eintragen (Project Settings → API).`,
        });
      } else if (url.protocol !== 'https:' && !isLoopback(url)) {
        findings.push({
          level: 'error',
          text: `${SUPABASE_URL} benutzt ${url.protocol} statt https.`,
          fix: 'Ohne TLS lehnt der Browser die Anfragen von einer HTTPS-Seite aus ohnehin ab.',
        });
      } else if (url.pathname !== '/' && url.pathname !== '') {
        findings.push({
          level: 'error',
          text: `${SUPABASE_URL} enthält einen Pfad (${url.pathname}).`,
          fix: 'Nur das Projekt eintragen, ohne /rest/v1 oder Ähnliches – den Pfad setzt die Bibliothek.',
        });
      } else {
        urlRef = url.hostname.endsWith('.supabase.co') ? (url.hostname.split('.')[0] ?? null) : null;
        sync = { url: url.origin, ref: urlRef, host: url.hostname };

        // Eine eigene Domain vor Supabase ist zulässig, aber die mitgelieferte
        // nginx-Konfiguration erlaubt in `connect-src` nur *.supabase.co. Ohne Anpassung
        // blockiert die CSP jeden Sync-Lauf – und zwar erst im Browser des Nutzers.
        if (urlRef === null && !isLoopback(url)) {
          findings.push({
            level: 'warn',
            text: `${url.hostname} ist keine *.supabase.co-Adresse.`,
            fix: 'connect-src in deploy/nginx/tidypepple.conf um diesen Host erweitern.',
          });
        }
      }
    }
  }

  if (rawKey !== '' && !PLACEHOLDERS.has(rawKey)) {
    // Die neuen Supabase-Schlüssel tragen ihre Rolle im Präfix, die alten im JWT.
    if (rawKey.startsWith('sb_secret_')) {
      findings.push({
        level: 'error',
        text: `${SUPABASE_ANON_KEY} enthält einen Secret-Key.`,
        fix: 'Der publishable/anon-Key gehört hierher. Ein Secret-Key im Build wäre öffentlich und umgeht jede RLS-Regel.',
      });
    } else if (!rawKey.startsWith('sb_publishable_')) {
      const payload = jwtPayload(rawKey);
      if (payload === null) {
        findings.push({
          level: 'error',
          text: `${SUPABASE_ANON_KEY} sieht nach keinem Supabase-Key aus.`,
          fix: 'Erwartet wird der anon/publishable Key aus Project Settings → API.',
        });
      } else {
        const role = typeof payload['role'] === 'string' ? payload['role'] : null;
        const keyRef = typeof payload['ref'] === 'string' ? payload['ref'] : null;
        const exp = typeof payload['exp'] === 'number' ? payload['exp'] : null;

        if (role === 'service_role') {
          findings.push({
            level: 'error',
            text: `${SUPABASE_ANON_KEY} enthält den service_role-Key.`,
            fix: 'Alles mit VITE_-Präfix wird in den Build eingebacken und ist öffentlich. Der service_role-Key umgeht sämtliche RLS – er gehört nur in die Supabase-Secrets der Edge Function.',
          });
        } else if (role !== 'anon') {
          findings.push({
            level: 'warn',
            text: `${SUPABASE_ANON_KEY} trägt die Rolle ${role ?? 'ohne Angabe'} statt anon.`,
          });
        }

        // Key und URL aus verschiedenen Projekten: der Build sieht gesund aus, jede
        // Anfrage scheitert dann mit „Invalid API key".
        if (keyRef !== null && urlRef !== null && keyRef !== urlRef) {
          findings.push({
            level: 'error',
            text: `Key und URL gehören zu verschiedenen Projekten (Key: ${keyRef}, URL: ${urlRef}).`,
            fix: 'Beide Werte aus demselben Projekt kopieren.',
          });
        }

        if (exp !== null && exp * 1000 < Date.now()) {
          findings.push({
            level: 'error',
            text: `${SUPABASE_ANON_KEY} ist abgelaufen.`,
            fix: 'Im Dashboard unter Project Settings → API einen aktuellen Key holen.',
          });
        }
      }
    }
  }

  const rawCheckout = read(env, CHECKOUT_URL);
  /** @type {string | null} */
  let checkout = null;
  if (rawCheckout !== '' && !PLACEHOLDERS.has(rawCheckout)) {
    try {
      const url = new URL(rawCheckout);
      if (url.protocol !== 'https:') {
        findings.push({
          level: 'error',
          text: `${CHECKOUT_URL} benutzt ${url.protocol} statt https.`,
        });
      } else {
        checkout = url.toString();
        // Die App hängt den Parameter selbst an; ein fest eingetragener Wert würde
        // jedes Abo demselben Konto zuschreiben.
        if (url.searchParams.has('checkout[custom][user_id]')) {
          findings.push({
            level: 'warn',
            text: `${CHECKOUT_URL} enthält bereits checkout[custom][user_id].`,
            fix: 'Den Parameter weglassen – die App setzt ihn pro Konto.',
          });
        }
      }
    } catch {
      findings.push({
        level: 'error',
        text: `${CHECKOUT_URL} ist keine gültige URL: ${rawCheckout}`,
      });
    }
  }

  // Nur ein ausdrückliches `on` zählt. Ein Tippfehler wie `true` soll auffallen, statt
  // stumm keine Zahlen zu liefern – bemerkt erst Tage später im leeren Dashboard.
  const rawBeacon = read(env, BEACON);
  if (rawBeacon !== '' && rawBeacon !== 'on' && rawBeacon !== 'off') {
    findings.push({
      level: 'error',
      text: `${BEACON} ist ${rawBeacon}, erwartet wird on oder off.`,
    });
  }

  const rawPlay = read(env, PLAY_BILLING);
  if (rawPlay !== '' && rawPlay !== 'on' && rawPlay !== 'off') {
    findings.push({
      level: 'error',
      text: `${PLAY_BILLING} ist ${rawPlay}, erwartet wird on oder off.`,
    });
  }

  return {
    sync,
    checkout,
    beacon: rawBeacon === 'on',
    playBilling: rawPlay === 'on',
    configured: rawUrl !== '' || rawKey !== '',
    findings,
  };
}

/** @param {EnvReport} report */
export const hasErrors = (report) => report.findings.some((f) => f.level === 'error');

/**
 * Menschenlesbare Zusammenfassung. Sie nennt bewusst das erkannte Ziel: beim Deployment
 * ist „gegen welches Projekt baut das hier eigentlich" die eigentliche Frage.
 *
 * @param {EnvReport} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [];
  if (report.sync === null) {
    lines.push(
      report.configured
        ? 'Sync:     konfiguriert, aber unbrauchbar – siehe unten.'
        : 'Sync:     nicht konfiguriert – die App läuft rein lokal.',
    );
  } else {
    lines.push(`Sync:     ${report.sync.url}${report.sync.ref === null ? '' : ` (Projekt ${report.sync.ref})`}`);
  }
  lines.push(`Checkout: ${report.checkout === null ? 'nicht konfiguriert – kein Abo-Kauf in der App.' : report.checkout}`);
  lines.push(`Beacon:   ${report.beacon ? 'an – die App meldet Starts an /beacon.' : 'aus – keine Nutzungszahlen.'}`);
  lines.push(
    `Play:     ${report.playBilling ? 'an – die Android-App verkauft Abos über Google Play.' : 'aus – die Android-App bietet keinen Kauf an.'}`,
  );

  for (const finding of report.findings) {
    lines.push('', `${finding.level === 'error' ? 'FEHLER' : 'Hinweis'}: ${finding.text}`);
    if (finding.fix !== undefined) lines.push(`         ${finding.fix}`);
  }
  return lines.join('\n');
}
