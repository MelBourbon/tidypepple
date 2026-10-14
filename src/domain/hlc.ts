/**
 * Hybrid Logical Clock als lexikografisch vergleichbarer String:
 *
 *     000001757000000:0000:a1b2c3d4
 *     └ physische ms ┘ └cnt┘ └Gerät┘
 *
 * Warum String und nicht Zahl: der Server kann Konflikte per `>` auf einer Textspalte
 * entscheiden, ohne den (verschlüsselten) Inhalt zu kennen. Der Zähler trennt Schreibvorgänge
 * innerhalb derselben Millisekunde, die Geräte-ID macht die Ordnung total.
 */

const MILLIS_DIGITS = 15;
const COUNTER_MAX = 0xffff;

export interface HlcState {
  millis: number;
  counter: number;
  deviceId: string;
}

export function formatHlc(state: HlcState): string {
  const millis = String(state.millis).padStart(MILLIS_DIGITS, '0');
  const counter = state.counter.toString(16).padStart(4, '0');
  return `${millis}:${counter}:${state.deviceId}`;
}

const HLC_PATTERN = new RegExp(`^\\d{${MILLIS_DIGITS}}:[0-9a-f]{4}:[^:]+$`);

/** Hat der Zeitstempel das Format oben? Fremde Daten werden vor dem Vergleich daran gemessen. */
export const isValidHlc = (value: unknown): value is string => typeof value === 'string' && HLC_PATTERN.test(value);

export function parseHlc(hlc: string): HlcState {
  const [millis, counter, deviceId] = hlc.split(':');
  if (millis === undefined || counter === undefined || deviceId === undefined) {
    throw new Error(`Ungültige HLC: ${hlc}`);
  }
  return { millis: Number(millis), counter: parseInt(counter, 16), deviceId };
}

/** Nächster Zeitstempel für einen lokalen Schreibvorgang. Mutiert `state` nicht. */
export function tick(state: HlcState, physicalNow: number): HlcState {
  if (physicalNow > state.millis) {
    return { millis: physicalNow, counter: 0, deviceId: state.deviceId };
  }
  if (state.counter >= COUNTER_MAX) {
    // Zähler erschöpft: eine Millisekunde vorspulen, damit die Ordnung monoton bleibt.
    return { millis: state.millis + 1, counter: 0, deviceId: state.deviceId };
  }
  return { millis: state.millis, counter: state.counter + 1, deviceId: state.deviceId };
}

/**
 * Uhr nach Empfang eines fremden Zeitstempels nachziehen. Verhindert, dass ein Gerät mit
 * nachlaufender Systemuhr dauerhaft "in der Vergangenheit" schreibt und seine Änderungen
 * dadurch systematisch verliert.
 */
export function merge(state: HlcState, remote: string, physicalNow: number): HlcState {
  const r = parseHlc(remote);
  const millis = Math.max(state.millis, r.millis, physicalNow);
  let counter: number;
  if (millis === state.millis && millis === r.millis) counter = Math.max(state.counter, r.counter) + 1;
  else if (millis === state.millis) counter = state.counter + 1;
  else if (millis === r.millis) counter = r.counter + 1;
  else counter = 0;
  return { millis, counter: Math.min(counter, COUNTER_MAX), deviceId: state.deviceId };
}

/** `true`, wenn `a` neuer ist als `b`. Reiner String-Vergleich – siehe Format oben. */
export const isNewer = (a: string, b: string): boolean => a > b;
