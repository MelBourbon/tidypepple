import { describe, expect, it } from 'vitest';
import { detectPlatform, withoutMarker } from '@/platform';

const web = { search: '', referrer: '', remembered: null, bridge: false };

describe('detectPlatform', () => {
  it('ist im normalen Browser immer web', () => {
    expect(detectPlatform(web)).toBe('web');
    expect(detectPlatform({ ...web, search: '?capture=1', referrer: 'https://www.google.com/' })).toBe('web');
  });

  it('erkennt den Start aus der TWA an start_url /?src=twa', () => {
    expect(detectPlatform({ ...web, search: '?src=twa' })).toBe('twa');
    expect(detectPlatform({ ...web, search: '?src=twa&capture=1' })).toBe('twa');
  });

  it('erkennt den Android-Referrer der eigenen App, nicht den fremder Apps', () => {
    expect(detectPlatform({ ...web, referrer: 'android-app://net.roeslr.tidypepple/' })).toBe('twa');
    expect(detectPlatform({ ...web, referrer: 'android-app://com.google.android.gm/' })).toBe('web');
  });

  it('bleibt nach der ersten Navigation bei der App-Plattform', () => {
    expect(detectPlatform({ ...web, remembered: 'twa' })).toBe('twa');
    expect(detectPlatform({ ...web, remembered: 'android' })).toBe('android');
    expect(detectPlatform({ ...web, remembered: 'irgendwas' })).toBe('web');
  });

  it('erkennt die WebView-Hülle an ?src=android oder an ihrer Bridge', () => {
    expect(detectPlatform({ ...web, search: '?src=android' })).toBe('android');
    expect(detectPlatform({ ...web, search: '?checkout=done&src=android' })).toBe('android');
    // App Link ohne Marker, etwa nach einem Neustart der App: die Bridge reicht.
    expect(detectPlatform({ ...web, bridge: true })).toBe('android');
    expect(detectPlatform({ ...web, bridge: true, remembered: 'twa' })).toBe('android');
  });
});

describe('withoutMarker', () => {
  it('entfernt nur den App-Marker und lässt andere Parameter stehen', () => {
    expect(withoutMarker('?src=twa')).toBe('');
    expect(withoutMarker('?src=twa&capture=1')).toBe('?capture=1');
    expect(withoutMarker('?capture=1&src=android')).toBe('?capture=1');
    expect(withoutMarker('?capture=1')).toBe('?capture=1');
    expect(withoutMarker('?src=newsletter')).toBe('?src=newsletter');
  });
});
