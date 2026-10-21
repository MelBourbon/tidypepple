import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { QuickCapture } from './QuickCapture';
import { SyncIndicator } from './SyncIndicator';
import { AppUpdateBanner } from './AppUpdateBanner';
import { ReminderScheduler } from './ReminderScheduler';
import { UpdatePrompt } from './UpdatePrompt';
import { useSync } from '@/sync/SyncProvider';
import { pingStart, syncLevel } from '@/telemetry';
import { t } from '@/i18n';

/**
 * Navigation: höchstens fünf Ziele (Hick's Law), unten im Daumenbereich auf dem Handy,
 * ab Tablet-Breite als Seitenleiste. Beides dieselbe Liste – eine Quelle für beide Layouts.
 */
const NAV = [
  { to: '/inbox', label: t.nav.inbox, icon: 'M2 8h4l1.5 2.5h1L10 8h4v5.5H2z M2 8 4 3h8l2 5' },
  { to: '/', label: t.nav.list, icon: 'M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01' },
  { to: '/all', label: t.nav.all, icon: 'M8 2 14 5 8 8 2 5zM2 8l6 3 6-3M2 11l6 3 6-3' },
  { to: '/projects', label: t.nav.projects, icon: 'M2 5.5A1.5 1.5 0 0 1 3.5 4h2L7 5.5h5.5A1.5 1.5 0 0 1 14 7v5H2z' },
  { to: '/board', label: t.nav.board, icon: 'M2.5 3h3v10h-3zM6.5 3h3v6h-3zM10.5 3h3v8h-3z' },
] as const;

function NavIcon({ path }: { path: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell(): ReactNode {
  const [capturing, setCapturing] = useState(false);
  const { pathname } = useLocation();
  const { state: syncState } = useSync();

  // Start-Ping erst, wenn feststeht, ob synchronisiert wird – sonst meldete jeder Start "lokal".
  useEffect(() => {
    const level = syncLevel(syncState);
    if (level !== null) pingStart(level);
  }, [syncState]);

  // Das Board ist die einzige Ansicht, die die volle Breite braucht – Listen bleiben bei
  // höchstens 896px, sonst wandert das Auge zu weit vom Kreis zum Zeilenende.
  const wide = pathname === '/board';
  // Im Detail liegt unten ein Eingabefeld ("Schritt hinzufügen"); dort würde der
  // schwebende Knopf genau darauf liegen.
  const showFab = !pathname.startsWith('/task/') && !pathname.startsWith('/projects/');

  // Tastaturbedienung: "c" erfasst von überall, solange nicht gerade getippt wird.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, [contenteditable="true"]') ?? false;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'c') {
        event.preventDefault();
        setCapturing(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Manifest-Shortcut "Schnell erfassen" öffnet die App mit ?capture=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('capture') === '1') setCapturing(true);
  }, []);

  return (
    // Die Seitenleiste sitzt immer am linken Rand – auch beim Wechsel zum Board springt sie
    // nicht. Die Listen stehen mittig im übrigen Platz.
    <div className="flex min-h-dvh md:gap-6 md:px-4">
      <nav aria-label={t.app} className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col gap-1 py-6 md:flex">
        <span className="px-3 pb-4 text-heading-14">{t.app}</span>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors',
                isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-raised hover:text-ink',
              ].join(' ')
            }
          >
            <NavIcon path={item.icon} />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setCapturing(true)}
          className="mt-3 flex h-10 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          {t.capture.open}
        </button>
        <div className="mt-auto px-3">
          <SyncIndicator />
        </div>
      </nav>

      {/* pb-28: Platz für Bottom-Nav und FAB, damit nichts die letzte Karte verdeckt.
          Board: genau Viewporthöhe, damit die Spalten selbst scrollen und die horizontale
          Scrollleiste immer sichtbar am unteren Rand liegt. */}
      <main className={['min-w-0 flex-1 pb-28 md:pb-8', wide ? 'flex h-dvh flex-col' : ''].join(' ')}>
        {wide ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-4xl">
            <Outlet />
          </div>
        )}
      </main>

      {showFab && (
        // Über der Bottom-Nav (3.5rem + Rand + Safe-Area-Inset) mit gut 1rem Luft. Ein fester
        // Wert reicht nicht: auf Geräten mit Gestenleiste wächst die Nav um den Inset.
        <button
          type="button"
          onClick={() => setCapturing(true)}
          aria-label={t.capture.open}
          className="fixed right-4 bottom-[calc(4.625rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-2xl text-accent-ink shadow-menu transition-colors hover:bg-accent-hover md:hidden"
        >
          <span aria-hidden="true">+</span>
        </button>
      )}

      <nav
        aria-label={t.app}
        className="pb-safe fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 backdrop-blur md:hidden"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs',
                isActive ? 'text-accent' : 'text-muted',
              ].join(' ')
            }
          >
            <NavIcon path={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <QuickCapture open={capturing} onClose={() => setCapturing(false)} />
      <ReminderScheduler />
      {/* Hinweise unten übereinander statt aufeinander. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-32 z-40 flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AppUpdateBanner />
        <UpdatePrompt />
      </div>
    </div>
  );
}
