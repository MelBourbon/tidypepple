import { describe, expect, it } from 'vitest';
import { formatHlc, isNewer, merge, parseHlc, tick } from '@/domain/hlc';

const state = (millis: number, counter = 0, deviceId = 'aaaa') => ({ millis, counter, deviceId });

describe('HLC', () => {
  it('ist lexikografisch nach Zeit sortierbar', () => {
    const early = formatHlc(state(1_700_000_000_000));
    const late = formatHlc(state(1_700_000_000_001));
    expect(isNewer(late, early)).toBe(true);
    expect([late, early].sort()).toEqual([early, late]);
  });

  it('trennt Schreibvorgänge innerhalb derselben Millisekunde über den Zähler', () => {
    const a = tick(state(1000), 1000);
    const b = tick(a, 1000);
    expect(isNewer(formatHlc(b), formatHlc(a))).toBe(true);
  });

  it('bleibt monoton, wenn die Systemuhr zurückspringt', () => {
    const before = state(5000);
    const after = tick(before, 4000);
    expect(isNewer(formatHlc(after), formatHlc(before))).toBe(true);
  });

  it('zieht die Uhr nach einem fremden Zeitstempel aus der Zukunft nach', () => {
    const local = state(1000);
    const remote = formatHlc(state(9000, 0, 'bbbb'));
    const merged = merge(local, remote, 1000);
    expect(merged.millis).toBe(9000);
    expect(isNewer(formatHlc(merged), remote)).toBe(true);
  });

  it('behält beim Mergen die eigene Geräte-ID', () => {
    expect(merge(state(1000), formatHlc(state(9000, 0, 'bbbb')), 1000).deviceId).toBe('aaaa');
  });

  it('kann formatierte Zeitstempel wieder einlesen', () => {
    const s = state(1_700_000_000_123, 42);
    expect(parseHlc(formatHlc(s))).toEqual(s);
  });

  it('lehnt kaputte Zeitstempel ab, statt still Unsinn zu liefern', () => {
    expect(() => parseHlc('kaputt')).toThrow();
  });
});
