import type { Platform } from '@/platform';
import { playManageUrl } from './googleplay';

/**
 * Das eigene Abo, wie die Einstellungen es anzeigen: „aktiv, verwaltet über …“.
 * Nur Anzeige – ob synchronisiert werden darf, entscheidet weiter allein der Server.
 *
 * Die RLS-Policy „eigenes Abo lesen“ gibt nur Abos mit der eigenen User-ID heraus. Ein
 * ohne Konto gekauftes Abo (Zuordnung über die E-Mail) taucht hier deshalb nicht auf;
 * dann zeigt die App eben keinen Anbieter an.
 */

export interface SubscriptionRow {
  provider: string;
  status: string;
  current_period_end: string | null;
}

export interface SubscriptionInfo {
  provider: 'lemonsqueezy' | 'google_play' | 'other';
  /** Verlängert sich automatisch. `false`: gekündigt, läuft bis `until`. */
  renews: boolean;
  until: Date | null;
}

const providerOf = (raw: string): SubscriptionInfo['provider'] =>
  raw === 'lemonsqueezy' || raw === 'google_play' ? raw : 'other';

/** Dieselben Regeln wie `has_active_sync()`, damit Anzeige und Server übereinstimmen. */
function entitles(row: SubscriptionRow, now: Date): boolean {
  const end = row.current_period_end === null ? null : new Date(row.current_period_end);
  if (row.status === 'active' || row.status === 'past_due') return end === null || end > now;
  if (row.status === 'canceled') return end !== null && end > now;
  return false;
}

/** Das berechtigende Abo mit der längsten Laufzeit, oder `null`. */
export function currentSubscription(rows: SubscriptionRow[], now = new Date()): SubscriptionInfo | null {
  const best = rows
    .filter((r) => entitles(r, now))
    .sort((a, b) => (b.current_period_end ?? '9999').localeCompare(a.current_period_end ?? '9999'))[0];
  if (best === undefined) return null;
  return {
    provider: providerOf(best.provider),
    renews: best.status !== 'canceled',
    until: best.current_period_end === null ? null : new Date(best.current_period_end),
  };
}

/** Kundenportal von LemonSqueezy; Anmeldung dort per Link an die Bestell-E-Mail. */
export const LEMONSQUEEZY_MANAGE_URL = 'https://app.lemonsqueezy.com/my-orders';

/**
 * Wo sich das Abo verwalten lässt. In der App aus Google Play (`twa`) gibt es keinen Link
 * zu LemonSqueezy: Google Play erlaubt dort keine Verweise auf fremde Bezahlwege. Die
 * Android-App zum Direktdownload öffnet das Kundenportal im Custom Tab.
 */
export function manageUrl(info: SubscriptionInfo, platform: Platform): string | null {
  if (info.provider === 'google_play') return playManageUrl();
  if (info.provider === 'lemonsqueezy' && platform !== 'twa') return LEMONSQUEEZY_MANAGE_URL;
  return null;
}
