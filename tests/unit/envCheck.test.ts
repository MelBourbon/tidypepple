import { describe, expect, it } from 'vitest';
import { checkEnv, hasErrors } from '../../scripts/env-check.mjs';

/**
 * Die Prüfung entscheidet, ob ein Deployment brauchbar ist. Sie ist ohne Supabase
 * testbar, weil ein Key alles mitbringt, worauf sie schaut: Rolle, Projekt und Ablauf
 * stehen in der Nutzlast.
 */

const jwt = (payload: Record<string, unknown>): string =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

const ANON = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' });

const VALID = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  VITE_SUPABASE_ANON_KEY: ANON,
};

/** Erste Fehlermeldung, damit die Erwartungen nicht an der Reihenfolge hängen. */
const errorsOf = (env: Record<string, unknown>): string[] =>
  checkEnv(env)
    .findings.filter((f) => f.level === 'error')
    .map((f) => f.text);

describe('checkEnv', () => {
  it('lässt eine leere Konfiguration durchgehen – die App läuft dann lokal', () => {
    const report = checkEnv({});
    expect(report.findings).toEqual([]);
    expect(report.sync).toBeNull();
    expect(report.configured).toBe(false);
  });

  it('erkennt das Zielprojekt', () => {
    const report = checkEnv(VALID);
    expect(report.findings).toEqual([]);
    expect(report.sync).toEqual({
      url: 'https://abcdefghijklmnop.supabase.co',
      ref: 'abcdefghijklmnop',
      host: 'abcdefghijklmnop.supabase.co',
    });
  });

  it('nimmt leere Werte wie fehlende – eine leere Zeile ist keine Konfiguration', () => {
    expect(checkEnv({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: '' }).sync).toBeNull();
  });

  // Der eigentliche Anlass der Prüfung: ohne sie entsteht hier ein stiller lokaler Build.
  it('bricht ab, wenn nur eine der beiden Variablen gesetzt ist', () => {
    expect(errorsOf({ VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL })).toContainEqual(
      expect.stringContaining('VITE_SUPABASE_ANON_KEY fehlt'),
    );
    expect(errorsOf({ VITE_SUPABASE_ANON_KEY: ANON })).toContainEqual(
      expect.stringContaining('VITE_SUPABASE_URL fehlt'),
    );
  });

  // Der wahrscheinlichste Zustand direkt nach `cp .env.example .env`.
  it('nennt einen nicht ersetzten Platzhalter beim Namen', () => {
    const report = checkEnv({
      VITE_SUPABASE_URL: 'https://your-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'your-anon-key',
    });
    expect(report.findings.map((f) => f.text)).toEqual([
      'VITE_SUPABASE_URL enthält noch den Platzhalter aus .env.example.',
      'VITE_SUPABASE_ANON_KEY enthält noch den Platzhalter aus .env.example.',
    ]);
    // Ein Platzhalter darf nicht als erkanntes Ziel durchgehen.
    expect(report.sync).toBeNull();
  });

  it('erkennt auch die Platzhalter der früheren deutschen Vorlage', () => {
    const report = checkEnv({
      VITE_SUPABASE_URL: 'https://dein-projekt.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'dein-anon-key',
    });
    expect(report.findings).toHaveLength(2);
    expect(report.sync).toBeNull();
  });

  it('weist den service_role-Key ab', () => {
    const env = { ...VALID, VITE_SUPABASE_ANON_KEY: jwt({ ref: 'abcdefghijklmnop', role: 'service_role' }) };
    expect(errorsOf(env)).toContainEqual(expect.stringContaining('service_role'));
  });

  it('weist einen Secret-Key im neuen Format ab', () => {
    const env = { ...VALID, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc123' };
    expect(errorsOf(env)).toContainEqual(expect.stringContaining('Secret-Key'));
  });

  it('akzeptiert einen publishable Key im neuen Format', () => {
    expect(checkEnv({ ...VALID, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc123' }).findings).toEqual([]);
  });

  it('erkennt Key und URL aus verschiedenen Projekten', () => {
    const env = { ...VALID, VITE_SUPABASE_ANON_KEY: jwt({ ref: 'einanderesprojekt', role: 'anon' }) };
    expect(errorsOf(env)).toContainEqual(expect.stringContaining('verschiedenen Projekten'));
  });

  it('erkennt einen abgelaufenen Key', () => {
    const expired = jwt({ ref: 'abcdefghijklmnop', role: 'anon', exp: 1_600_000_000 });
    expect(errorsOf({ ...VALID, VITE_SUPABASE_ANON_KEY: expired })).toContainEqual(
      expect.stringContaining('abgelaufen'),
    );
  });

  it('erkennt die Dashboard-Adresse statt der API-URL', () => {
    const env = { ...VALID, VITE_SUPABASE_URL: 'https://supabase.com/dashboard/project/abcdefghijklmnop' };
    const report = checkEnv(env);
    expect(hasErrors(report)).toBe(true);
    expect(report.findings[0]?.fix).toContain('https://abcdefghijklmnop.supabase.co');
    // Gesetzt, aber unbrauchbar: im Log darf das nicht wie ein lokaler Build aussehen.
    expect(report.configured).toBe(true);
  });

  it('weist eine URL mit Pfad ab', () => {
    const env = { ...VALID, VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co/rest/v1' };
    expect(errorsOf(env)).toContainEqual(expect.stringContaining('Pfad'));
  });

  it('weist unverschlüsselte Adressen ab, außer auf der Loopback-Adresse', () => {
    expect(errorsOf({ ...VALID, VITE_SUPABASE_URL: 'http://staging.example.com' })).toHaveLength(1);
    // `supabase start` liefert lokal ohne TLS aus – das ist legitim.
    const local = checkEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: ANON });
    expect(hasErrors(local)).toBe(false);
  });

  // Eine eigene Domain ist erlaubt, aber die nginx-CSP erlaubt nur *.supabase.co.
  it('warnt bei eigener Domain, ohne den Build abzubrechen', () => {
    const env = { ...VALID, VITE_SUPABASE_URL: 'https://api.tidypepple.example.com' };
    const report = checkEnv(env);
    expect(hasErrors(report)).toBe(false);
    expect(report.findings[0]?.fix).toContain('connect-src');
  });

  it('warnt, wenn die Checkout-URL die User-ID schon fest enthält', () => {
    const report = checkEnv({
      ...VALID,
      VITE_LEMONSQUEEZY_CHECKOUT_URL: 'https://s.lemonsqueezy.com/buy/v1?checkout[custom][user_id]=17',
    });
    expect(hasErrors(report)).toBe(false);
    expect(report.findings[0]?.text).toContain('checkout[custom][user_id]');
  });

  it('schaltet das Beacon nur mit ausdrücklichem on ein', () => {
    expect(checkEnv({}).beacon).toBe(false);
    expect(checkEnv({ VITE_BEACON: 'off' }).beacon).toBe(false);
    expect(checkEnv({ VITE_BEACON: 'on' }).beacon).toBe(true);
    expect(errorsOf({ VITE_BEACON: 'true' })[0]).toContain('VITE_BEACON');
  });

  it('schaltet Google Play Billing nur mit ausdrücklichem on ein', () => {
    expect(checkEnv({}).playBilling).toBe(false);
    expect(checkEnv({ VITE_PLAY_BILLING: 'off' }).playBilling).toBe(false);
    expect(checkEnv({ VITE_PLAY_BILLING: 'on' }).playBilling).toBe(true);
    expect(errorsOf({ VITE_PLAY_BILLING: 'yes' })[0]).toContain('VITE_PLAY_BILLING');
  });

  it('erkennt die Checkout-URL, wenn sie stimmt', () => {
    const url = 'https://store.lemonsqueezy.com/buy/11111111-2222-3333-4444-555555555555';
    const report = checkEnv({ ...VALID, VITE_LEMONSQUEEZY_CHECKOUT_URL: url });
    expect(report.findings).toEqual([]);
    expect(report.checkout).toBe(url);
  });
});
