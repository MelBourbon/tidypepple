import { describe, expect, it } from 'vitest';
import { formatDueLabel } from '@/domain/dates';
import { de } from '@/i18n/de';
import { en } from '@/i18n/en';
import { detectLocale } from '@/i18n';

describe('detectLocale', () => {
  it('nimmt die erste Browsersprache, die es gibt', () => {
    expect(detectLocale(['de-DE', 'en-US'])).toBe('de');
    expect(detectLocale(['en-GB', 'de'])).toBe('en');
    expect(detectLocale(['fr-FR', 'de-AT'])).toBe('de');
  });

  it('fällt auf Englisch zurück', () => {
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});

describe('formatDueLabel', () => {
  const REF = '2026-09-27'; // ein Sonntag
  const labels = (m: typeof de | typeof en) => ({ ...m.due, weekdaysShort: m.weekdaysShort, dateLocale: m.dateLocale });

  it('beschriftet in der gewählten Sprache', () => {
    expect(formatDueLabel('2026-09-27', labels(de), REF)).toBe('Heute');
    expect(formatDueLabel('2026-09-28', labels(en), REF)).toBe('Tomorrow');
    expect(formatDueLabel('2026-10-01', labels(de), REF)).toBe('Do');
    expect(formatDueLabel('2026-10-01', labels(en), REF)).toBe('Thu');
    expect(formatDueLabel('2026-10-20', labels(en), REF)).toBe('20 Oct');
  });
});
