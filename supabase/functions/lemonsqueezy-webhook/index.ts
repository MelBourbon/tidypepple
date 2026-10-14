/**
 * LemonSqueezy-Webhook → Tabelle `subscriptions`.
 *
 * Läuft als Supabase Edge Function (Deno). Die eigentliche Logik steht in
 * `../_shared/lemonsqueezy.ts` und ist dort ohne Deno testbar; hier bleibt nur die
 * Verdrahtung.
 *
 * Einrichten:
 *   supabase secrets set LEMONSQUEEZY_SIGNING_SECRET=...
 *   supabase secrets set LEMONSQUEEZY_VARIANT_IDS=123456,123457   # Varianten des Sync-Abos
 *   supabase secrets set LEMONSQUEEZY_ALLOW_TEST_MODE=true   # nur solange getestet wird
 *   supabase functions deploy lemonsqueezy-webhook --no-verify-jwt
 *
 * `--no-verify-jwt` ist nötig, weil LemonSqueezy kein Supabase-Token mitschickt.
 * Authentifiziert wird stattdessen über die HMAC-Signatur – deshalb ist deren
 * Prüfung hier die einzige Sicherheitsgrenze und darf nie übersprungen werden.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseVariantIds, parseWebhook, verifySignature, wantsLoginLink } from '../_shared/lemonsqueezy.ts';

const SIGNING_SECRET = Deno.env.get('LEMONSQUEEZY_SIGNING_SECRET') ?? '';
// Nur Abos dieser Varianten berechtigen. Der Webhook sieht alle Abos des Stores – auch die
// anderer Produkte, etwa einer zweiten App im selben Store.
const VARIANT_IDS = parseVariantIds(Deno.env.get('LEMONSQUEEZY_VARIANT_IDS'));
// Testkäufe nur annehmen, wenn ausdrücklich erlaubt – sonst gäben sie im Echtbetrieb
// kostenlos Sync-Berechtigung.
const ALLOW_TEST_MODE = Deno.env.get('LEMONSQUEEZY_ALLOW_TEST_MODE') === 'true';
// Adresse der App. Ohne sie wird nach einem Kauf ohne Konto kein Anmeldelink verschickt;
// der Käufer kann sich dann trotzdem selbst mit der E-Mail aus der Bestellung anmelden.
const APP_URL = Deno.env.get('APP_URL') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Für Uptime Kuma (HTTP-Monitor, GET): 200, wenn die Function läuft, konfiguriert ist und die
 * Datenbank erreicht. Sonst merkt niemand, dass Käufe ins Leere laufen – LemonSqueezy
 * wiederholt fehlgeschlagene Events nur ein paar Mal und gibt dann auf. Die Antwort nennt
 * keine Einzelheiten; die stehen im Log.
 */
async function health(): Promise<Response> {
  const checks: [string, boolean][] = [
    ['LEMONSQUEEZY_SIGNING_SECRET', SIGNING_SECRET !== ''],
    ['LEMONSQUEEZY_VARIANT_IDS', VARIANT_IDS.size > 0],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY !== ''],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length > 0) {
    console.error('Health: Secrets fehlen:', missing.join(', '));
    return new Response('Nicht konfiguriert', { status: 503 });
  }
  const { error } = await createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    .from('subscriptions')
    .select('provider_sub_id')
    .limit(1);
  if (error !== null) {
    console.error('Health: Datenbank nicht erreichbar:', error.message);
    return new Response('Datenbank nicht erreichbar', { status: 503 });
  }
  return new Response('OK', { status: 200 });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'GET') return health();
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (SIGNING_SECRET === '') {
    console.error('LEMONSQUEEZY_SIGNING_SECRET fehlt – Webhook wird abgelehnt.');
    return new Response('Nicht konfiguriert', { status: 500 });
  }
  // 500 statt 200: LemonSqueezy wiederholt das Event, sobald der Wert gesetzt ist, und im
  // Dashboard steht der Fehlschlag sichtbar – ein stilles „Ignoriert“ verlöre den Kauf.
  if (VARIANT_IDS.size === 0) {
    console.error('LEMONSQUEEZY_VARIANT_IDS fehlt – Webhook wird abgelehnt.');
    return new Response('Nicht konfiguriert', { status: 500 });
  }

  // Erst den rohen Text lesen, dann prüfen, dann parsen. Ein vorheriges `req.json()`
  // würde die signierte Bytefolge verändern und die Prüfung wertlos machen.
  const rawBody = await req.text();
  const valid = await verifySignature(rawBody, req.headers.get('X-Signature'), SIGNING_SECRET);
  if (!valid) return new Response('Ungültige Signatur', { status: 401 });

  let payload: Parameters<typeof parseWebhook>[0];
  let update: ReturnType<typeof parseWebhook>;
  try {
    payload = JSON.parse(rawBody);
    update = parseWebhook(payload, { allowedVariantIds: VARIANT_IDS, allowTestMode: ALLOW_TEST_MODE });
  } catch {
    return new Response('Kein gültiges JSON', { status: 400 });
  }

  // Irrelevantes Event, fremde Variante oder nicht erlaubter Testmodus: mit 200 bestätigen,
  // sonst wiederholt LemonSqueezy endlos. Protokolliert, damit eine vergessene Variante
  // in den Logs auffällt.
  if (update === null) {
    console.log('Ignoriert:', payload.meta?.event_name, payload.data?.type, payload.data?.attributes?.variant_id);
    return new Response('Ignoriert', { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Webhooks treffen doppelt und gelegentlich verdreht ein. Die Funktion verwirft ein Event,
  // das älter ist als der gespeicherte Stand – dieselbe Idee wie die HLC-Regel beim Datensync.
  // Als RPC, weil die Bedingung dort im `on conflict` steht und nicht von PostgREST abhängt.
  // Eine vorhandene Zuordnung zum Konto bleibt erhalten, wenn das Event keine mitbringt.
  const { error } = await supabase.rpc('apply_subscription_event', {
    p_provider_sub_id: update.providerSubId,
    p_user_id: update.userId,
    p_email: update.email,
    p_provider: 'lemonsqueezy',
    p_provider_customer_id: update.providerCustomerId,
    p_status: update.status,
    p_provider_status: update.providerStatus,
    p_current_period_end: update.currentPeriodEnd,
    p_event_at: update.eventAt,
  });

  if (error !== null) {
    console.error('Abo konnte nicht geschrieben werden:', error.message);
    // 500 ⇒ LemonSqueezy versucht es erneut. Genau das ist hier erwünscht.
    return new Response('Schreibfehler', { status: 500 });
  }

  // Erst nach dem Schreiben: die Mail soll nur rausgehen, wenn das Abo auch gilt.
  // Ein Fehler hier wird nur protokolliert – ein 500 ließe LemonSqueezy wiederholen und
  // ggf. mehrere Mails verschicken, und anmelden kann sich der Käufer auch selbst.
  if (wantsLoginLink(update) && update.email !== null && APP_URL !== '') {
    const { error: mailError } = await supabase.auth.signInWithOtp({
      email: update.email,
      options: { emailRedirectTo: APP_URL },
    });
    if (mailError !== null) console.error('Anmeldelink nach Kauf nicht verschickt:', mailError.message);
  }

  return new Response('OK', { status: 200 });
});
