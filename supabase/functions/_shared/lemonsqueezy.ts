/**
 * Reine Logik der LemonSqueezy-Anbindung: Signaturprüfung, Statusabbildung, Parsen.
 *
 * Bewusst ohne Deno- und ohne Supabase-Bezug, damit sie in den normalen Unit-Tests läuft.
 * Die Edge Function daneben ist nur noch Verdrahtung.
 */

/** Anbieterunabhängiges Vokabular – siehe `subscriptions.status` in 0001_schema.sql. */
export type SubscriptionStatus = 'active' | 'past_due' | 'paused' | 'canceled';

/**
 * LemonSqueezy-Status auf das eigene Vokabular abbilden.
 *
 * `cancelled` (mit zwei L) heißt "gekündigt, läuft aber bis zum Periodenende weiter".
 * Es wird deshalb auf `canceled` abgebildet, und ob noch synchronisiert werden darf,
 * entscheidet allein `current_period_end` – nicht dieser Status.
 */
export function normalizeStatus(providerStatus: string): SubscriptionStatus {
  switch (providerStatus) {
    case 'active':
    case 'on_trial':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return 'canceled';
    default:
      // Unbekannter Status: nicht raten. Kein Zugriff ist der sichere Ausgang, und der
      // Rohwert bleibt in `provider_status` für die Fehlersuche erhalten.
      return 'canceled';
  }
}

const HEX = /^[0-9a-f]+$/i;

/** Vergleich ohne frühen Abbruch, damit die Laufzeit nichts über das Geheimnis verrät. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256 über den **rohen** Body.
 *
 * Der Body muss unverändert hereinkommen – wer vorher `await req.json()` aufruft und
 * danach neu serialisiert, prüft eine andere Bytefolge als die signierte und bekommt
 * je nach Formatierung zufällig mal gültige, mal ungültige Ergebnisse.
 */
export async function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (signature === null || signature === '' || !HEX.test(signature)) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, signature.toLowerCase());
}

export interface SubscriptionUpdate {
  event: string;
  /** Konto aus `custom_data`, oder `null`, wenn ohne Konto gekauft wurde. */
  userId: string | null;
  /** E-Mail aus der Bestellung, kleingeschrieben. Ordnet ein Abo ohne Konto zu. */
  email: string | null;
  providerCustomerId: string | null;
  providerSubId: string;
  status: SubscriptionStatus;
  providerStatus: string;
  currentPeriodEnd: string | null;
  eventAt: string;
}

/**
 * Events, die den Abo-Zustand verändern. Alles andere wird bestätigt und ignoriert.
 *
 * Bewusst *nicht* dabei: `subscription_payment_*`. Deren `data` ist eine Rechnung, kein Abo
 * – `data.id` ist die Rechnungsnummer, `status` z. B. `paid`. Als Abo gelesen entstand daraus
 * eine Zeile mit der Rechnungsnummer als Abo-ID, und traf diese zufällig die Nummer eines
 * fremden Abos, wurde dieses auf „gekündigt“ gesetzt. Was eine Zahlung am Abo
 * ändert, meldet LemonSqueezy ohnehin zusätzlich als `subscription_updated`.
 */
const RELEVANT_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
]);

interface WebhookPayload {
  meta?: { event_name?: string; test_mode?: boolean; custom_data?: Record<string, unknown> };
  data?: {
    /** Objekttyp bei LemonSqueezy; für ein Abo `subscriptions`. */
    type?: string;
    id?: string;
    attributes?: {
      status?: string;
      variant_id?: number | string;
      customer_id?: number | string;
      user_email?: string;
      ends_at?: string | null;
      renews_at?: string | null;
      updated_at?: string;
    };
  };
}

export interface ParseOptions {
  /**
   * Varianten (Preisstufen) des Sync-Abos. Ein Webhook bekommt die Events des ganzen
   * Stores – ohne diesen Abgleich schaltete jedes andere Abo im Store, etwa einer zweiten
   * App oder eine günstigere Variante, den Sync frei. Pflicht, damit der
   * Abgleich nicht aus Versehen fehlt.
   */
  allowedVariantIds: ReadonlySet<string>;
  /**
   * Events aus dem LemonSqueezy-Testmodus annehmen. Standardmäßig aus: Ein Testkauf kostet
   * nichts und darf im Echtbetrieb keine Sync-Berechtigung verschaffen.
   */
  allowTestMode?: boolean;
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Nutzlast in eine Aktualisierung übersetzen, oder `null`, wenn das Event nichts
 * am Abo ändert bzw. sich weder einem Konto noch einer E-Mail-Adresse zuordnen lässt.
 *
 * Gekauft werden darf auch ohne Konto ("erst bezahlen, dann anmelden"). Dann fehlt
 * `custom_data.user_id`, und die E-Mail aus der Bestellung übernimmt die Zuordnung.
 *
 * Testmodus-Events liefern `null`, solange `allowTestMode` nicht gesetzt ist.
 */
export function parseWebhook(
  payload: WebhookPayload,
  { allowedVariantIds, allowTestMode = false }: ParseOptions,
): SubscriptionUpdate | null {
  const event = payload.meta?.event_name;
  if (event === undefined || !RELEVANT_EVENTS.has(event)) return null;
  if (payload.meta?.test_mode === true && !allowTestMode) return null;
  // Nur ein Abo-Objekt trägt Abo-ID, Status und Laufzeit – siehe RELEVANT_EVENTS.
  if (payload.data?.type !== 'subscriptions') return null;

  const subId = payload.data.id;
  const attributes = payload.data.attributes;
  if (subId === undefined || attributes === undefined) return null;
  if (attributes.variant_id === undefined || !allowedVariantIds.has(String(attributes.variant_id))) return null;

  const userId = nonEmpty(payload.meta?.custom_data?.['user_id']);
  const email = nonEmpty(attributes.user_email)?.toLowerCase() ?? null;
  if (userId === null && email === null) return null;

  const providerStatus = attributes.status ?? 'unknown';

  return {
    event,
    userId,
    email,
    providerCustomerId: attributes.customer_id === undefined ? null : String(attributes.customer_id),
    providerSubId: String(subId),
    status: normalizeStatus(providerStatus),
    providerStatus,
    // Bei einer Kündigung läuft das Abo bis `ends_at`, sonst bis zur nächsten Verlängerung.
    // Diese Reihenfolge ist entscheidend: sie gibt gekündigten Kunden die bezahlte Zeit.
    currentPeriodEnd: attributes.ends_at ?? attributes.renews_at ?? null,
    eventAt: attributes.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Erlaubte Varianten aus der Konfiguration, z. B. `"123456, 123457"` (Live- und
 * Testmodus-Variante haben verschiedene IDs). Leer, wenn nichts Brauchbares darin steht.
 */
export function parseVariantIds(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  );
}

/**
 * Nach einem Kauf ohne Konto schickt der Webhook selbst den Anmeldelink – sonst müsste
 * der Käufer von sich aus wissen, dass er sich jetzt noch anmelden soll. Nur beim
 * Anlegen: jede Verlängerung würde sonst eine weitere Mail auslösen.
 */
export const wantsLoginLink = (update: SubscriptionUpdate): boolean =>
  update.event === 'subscription_created' && update.userId === null && update.email !== null;
