import { describe, expect, it, vi } from 'vitest';
import { beaconUrl, errorName, syncLevel } from '@/telemetry';

describe('syncLevel', () => {
  it('wartet, solange der Sync-Zustand noch lädt', () => {
    expect(syncLevel('loading')).toBeNull();
  });

  it('verrät nur die Stufe, nichts über das Konto', () => {
    expect(syncLevel('unconfigured')).toBe('local');
    expect(syncLevel('signed-out')).toBe('local');
    expect(syncLevel('ready')).toBe('sync');
    expect(syncLevel('locked')).toBe('account');
    expect(syncLevel('needs-subscription')).toBe('account');
  });
});

describe('beaconUrl', () => {
  it('enthält keine Kennung, nur Ereignis, Modus, Version und Sync-Stufe', () => {
    const url = new URL(beaconUrl({ e: 'start', mode: 'standalone', v: 'v0.9.0', s: 'local' }), 'https://x');
    expect(url.pathname).toBe('/beacon');
    expect([...url.searchParams.keys()].sort()).toEqual(['e', 'mode', 's', 'v']);
  });

  it('kennzeichnet Starts aus der Android-App, Web-Pings bleiben unverändert', () => {
    expect(beaconUrl({ e: 'start', mode: 'standalone', v: 'v0.9.0', s: 'sync', p: 'twa' })).toBe(
      '/beacon?e=start&mode=standalone&v=v0.9.0&s=sync&p=twa',
    );
  });

  it('lässt die Sync-Stufe bei der Installation weg', () => {
    expect(beaconUrl({ e: 'install', mode: 'standalone', v: 'v0.9.0' })).toBe('/beacon?e=install&mode=standalone&v=v0.9.0');
  });
});

describe('Fehler-Ping', () => {
  it('meldet nur den Typ, nie die Meldung', () => {
    expect(errorName(new TypeError("Cannot read properties of undefined (reading 'Einkaufen')"))).toBe('TypeError');
    expect(errorName(new DOMException('x', 'QuotaExceededError'))).toBe('QuotaExceededError');
    expect(errorName('nur ein Text')).toBe('string');
    const odd = new Error('x');
    odd.name = 'Fehler mit Leerzeichen und Inhalt';
    expect(errorName(odd)).toBe('Unknown');
  });

  it('hängt Art und Typ an, aber keine Sync-Stufe', () => {
    expect(beaconUrl({ e: 'error', mode: 'browser', v: 'v1.0.0', k: 'render', n: 'TypeError' })).toBe(
      '/beacon?e=error&mode=browser&v=v1.0.0&k=render&n=TypeError',
    );
  });

  it('meldet gleiche Fehler einmal und höchstens drei je Start', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BEACON', 'on');
    const sent: string[] = [];
    vi.stubGlobal('navigator', { sendBeacon: (url: string) => (sent.push(url), true) });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const { reportError } = await import('@/telemetry');

    reportError('uncaught', new TypeError('Titel: Steuererklärung'));
    reportError('uncaught', new TypeError('b'));
    reportError('rejection', new TypeError('c'));
    reportError('render', new RangeError('d'));
    reportError('render', new SyntaxError('e'));

    expect(sent.map((u) => new URL(u, 'https://x').searchParams.get('n'))).toEqual(['TypeError', 'TypeError', 'RangeError']);
    expect(sent.join()).not.toContain('Steuer');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
