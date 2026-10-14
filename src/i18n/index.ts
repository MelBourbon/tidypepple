import { de, type Messages } from './de';
import { en } from './en';

/**
 * Die Sprache steht beim Laden fest: `t` ist eine Modulkonstante, die Komponenten direkt
 * importieren. Ein Wechsel in den Einstellungen lädt die App neu – das spart einen
 * Context-Provider um jeden Text, und man wechselt die Sprache nicht ständig.
 */

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type LocalePreference = Locale | 'auto';

/** Jede Sprache heißt so, wie ihre Sprecher sie nennen. */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

const MESSAGES: Record<Locale, Messages> = { de, en };

// Ein Gerätewunsch, kein Teil der Daten: gehört nicht in IndexedDB und wird nicht synchronisiert.
const STORAGE_KEY = 'tidypepple.locale';

/** Erste Browsersprache, die wir haben; sonst Englisch als die verständlichere Wahl. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (primary === 'de' || primary === 'en') return primary;
  }
  return 'en';
}

export function readLocalePreference(): LocalePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'de' || stored === 'en' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeLocalePreference(preference: LocalePreference): void {
  try {
    if (preference === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Ohne Speicher bleibt es bei der Browsersprache.
  }
}

export const browserLocale: Locale = detectLocale(
  typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]),
);

const preference = readLocalePreference();
export const locale: Locale = preference === 'auto' ? browserLocale : preference;

export const t: Messages = MESSAGES[locale];
