import { describe, expect, it } from 'vitest';
import { checkAppUpdate, compareVersion, parseVersionJson, VERSION_URL, type RemoteVersion } from '@/platform/appUpdate';

const remote = (patch: Partial<RemoteVersion> = {}): RemoteVersion => ({
  versionCode: 4,
  versionName: '2.0.1',
  url: 'https://tidypepple.com/android/',
  minVersionCode: 3,
  ...patch,
});

const bridge = (versionCode: number) => ({
  info: async () => ({ versionCode, versionName: 'x', bridge: 1 }),
});

const respond = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body }) as Response) as typeof fetch;

describe('compareVersion', () => {
  it('gleiche Version: nichts zu tun', () => {
    expect(compareVersion({ versionCode: 4 }, remote()).state).toBe('current');
  });

  it('neuere Version: Hinweis', () => {
    expect(compareVersion({ versionCode: 3 }, remote())).toEqual({
      state: 'available',
      versionCode: 4,
      versionName: '2.0.1',
      url: 'https://tidypepple.com/android/',
    });
  });

  it('unter minVersionCode: Pflicht', () => {
    expect(compareVersion({ versionCode: 2 }, remote()).state).toBe('required');
  });

  it('installierte Version neuer als die Website (Testbuild): nichts zu tun', () => {
    expect(compareVersion({ versionCode: 9 }, remote()).state).toBe('current');
  });
});

describe('parseVersionJson', () => {
  it('liest die Datei aus scripts/release.sh, Zusatzfelder stören nicht', () => {
    expect(
      parseVersionJson({ ...remote(), apk: 'https://tidypepple.com/android/tidypepple-2.0.1.apk', size: 1, sha256: 'a' }),
    ).toEqual(remote());
  });

  it('ohne minVersionCode ist nichts Pflicht', () => {
    const { minVersionCode: _, ...rest } = remote();
    expect(parseVersionJson(rest)?.minVersionCode).toBe(0);
  });

  it.each([
    ['kein Objekt', 'x'],
    ['null', null],
    ['versionCode fehlt', { ...remote(), versionCode: undefined }],
    ['versionCode als Text', { ...remote(), versionCode: '4' }],
    ['leerer versionName', { ...remote(), versionName: '' }],
    ['fremde Adresse', { ...remote(), url: 'https://example.com/tidypepple.apk' }],
    ['http statt https', { ...remote(), url: 'http://tidypepple.com/android/' }],
  ])('lehnt ab: %s', (_name, value) => {
    expect(parseVersionJson(value)).toBeNull();
  });
});

describe('checkAppUpdate', () => {
  it('fragt version.json ohne Cache ab', async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return { ok: true, json: async () => remote() } as Response;
    }) as typeof fetch;
    await expect(checkAppUpdate(bridge(3), fetchFn)).resolves.toMatchObject({ state: 'available' });
    expect(calls[0]?.[0]).toBe(VERSION_URL);
    expect(calls[0]?.[1]?.cache).toBe('no-store');
  });

  it('Serverfehler: kein Hinweis', async () => {
    await expect(checkAppUpdate(bridge(3), respond(remote(), false))).resolves.toBeNull();
  });

  it('kaputte Datei: kein Hinweis', async () => {
    await expect(checkAppUpdate(bridge(3), respond({ hello: 'world' }))).resolves.toBeNull();
  });

  it('offline: kein Hinweis', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(checkAppUpdate(bridge(3), offline)).resolves.toBeNull();
  });

  it('Bridge antwortet mit Fehler: kein Hinweis', async () => {
    const broken = { info: async () => Promise.reject(new Error('failed')) };
    await expect(checkAppUpdate(broken, respond(remote()))).resolves.toBeNull();
  });
});
