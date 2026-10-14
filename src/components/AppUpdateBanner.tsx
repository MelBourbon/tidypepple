import { useEffect, useState } from 'react';
import { getMeta, META_KEYS, setMeta } from '@/data/db';
import { t } from '@/i18n';
import { platform } from '@/platform';
import { androidBridge } from '@/platform/android';
import { checkAppUpdate, type AppUpdate } from '@/platform/appUpdate';

/**
 * Die App läuft oft tagelang im Hintergrund weiter. Deshalb wird nicht nur beim Start
 * gefragt, sondern auch beim Zurückkehren – aber selten, die Datei ändert sich kaum.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Hinweis auf eine neue APK der Android-App (Phase 7), nur in der WebView-Hülle.
 *
 * Ein normales Update lässt sich wegklicken und meldet sich erst bei der nächsten Version
 * wieder. Liegt die Hülle unter `minVersionCode`, bleibt der Hinweis stehen. Der Link ist
 * ein einfacher Link: Die Hülle öffnet fremde Adressen im Browser-Tab über der App, dort
 * lädt Android die APK herunter und bietet die Installation über die alte an.
 */
export function AppUpdateBanner(): React.ReactNode {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [dismissed, setDismissed] = useState<number | undefined>();

  useEffect(() => {
    const bridge = platform() === 'android' ? androidBridge() : null;
    if (bridge === null) return;
    let active = true;
    let lastCheck = 0;
    const check = (): void => {
      if (!navigator.onLine || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      void checkAppUpdate(bridge).then((result) => {
        if (active && result !== null) setUpdate(result);
      });
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    void getMeta<number>(META_KEYS.appUpdateDismissed).then((value) => {
      if (active) setDismissed(value);
    });
    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (update === null || update.state === 'current') return null;
  const required = update.state === 'required';
  if (!required && dismissed !== undefined && dismissed >= update.versionCode) return null;

  const dismiss = (): void => {
    setDismissed(update.versionCode);
    void setMeta(META_KEYS.appUpdateDismissed, update.versionCode);
  };

  return (
    <div
      role="status"
      className={[
        'pointer-events-auto flex items-center gap-3 rounded-card border bg-surface px-4 py-2.5 text-sm shadow-menu',
        required ? 'border-danger-line text-danger' : 'border-line',
      ].join(' ')}
    >
      {required ? t.appUpdate.required(update.versionName) : t.appUpdate.available(update.versionName)}
      <a href={update.url} className="font-medium text-accent hover:underline">
        {t.appUpdate.download}
      </a>
      {!required && (
        <button type="button" onClick={dismiss} className="text-muted hover:text-ink">
          {t.appUpdate.dismiss}
        </button>
      )}
    </div>
  );
}
