/**
 * Schriftgröße in drei Stufen. Gesetzt wird die Wurzelschriftgröße: Tailwind
 * rechnet Schrift *und* Abstände in rem, also wächst alles gleichmäßig mit – Ausrichtungen
 * wie Titel mittig zum Erledigt-Knopf bleiben erhalten. "Klein" statt "Sehr groß", weil
 * Firefox ohnehin recht groß rendert; wer mehr braucht, hat die Systemeinstellung, die
 * zusätzlich wirkt.
 */

export const TEXT_SIZES = ['small', 'normal', 'large'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

const SCALE: Record<TextSize, string> = { small: '87.5%', normal: '', large: '112.5%' };

/** Die frühere Stufe "Sehr groß" (125 %) gibt es nicht mehr; wer sie gewählt hatte, bekommt "Groß". */
const LEGACY: Record<string, TextSize> = { larger: 'large' };

// Wie die Sprache ein Gerätewunsch: nicht in IndexedDB, nicht synchronisiert.
const STORAGE_KEY = 'tidypepple.textSize';

export function readTextSize(): TextSize {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    return TEXT_SIZES.includes(stored as TextSize) ? (stored as TextSize) : (LEGACY[stored] ?? 'normal');
  } catch {
    return 'normal';
  }
}

export function applyTextSize(size: TextSize): void {
  document.documentElement.style.fontSize = SCALE[size];
}

export function writeTextSize(size: TextSize): void {
  try {
    if (size === 'normal') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Ohne Speicher gilt die Wahl bis zum nächsten Start.
  }
  applyTextSize(size);
}
