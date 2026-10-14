import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '@/i18n';

/**
 * Der Browser sucht von sich aus nur bei einer Navigation nach einem neuen Service Worker.
 * Auf dem Handy wird die App ständig neu gestartet, ein installiertes Desktop-Fenster bleibt
 * dagegen tagelang offen – als SPA ohne Navigation. Dort käme ein Update nie an, deshalb
 * wird zusätzlich regelmäßig und beim Zurückkehren ins Fenster nachgefragt.
 */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  const check = (): void => {
    if (registration.installing || !navigator.onLine) return;
    registration.update().catch(() => {
      // Offline oder Server kurz weg: beim nächsten Anlass erneut.
    });
  };
  setInterval(check, UPDATE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/**
 * Updates werden angeboten, nicht erzwungen: ein Reload mitten im Erfassen wäre
 * Datenverlust im Gefühl des Nutzers, auch wenn lokal nichts verloren geht.
 */
export function UpdatePrompt(): React.ReactNode {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) watchForUpdates(registration);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-sm shadow-menu">
      {t.update.available}
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="font-medium text-accent hover:underline"
      >
        {t.update.reload}
      </button>
    </div>
  );
}
