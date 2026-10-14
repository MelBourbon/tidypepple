import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StorageNotice } from './StorageNotice';
import { t } from '@/i18n';

/**
 * Kopfzeile aller Ansichten. Die Einstellungen hängen hier statt in der Bottom-Nav:
 * dort sind die fünf Plätze für den täglichen Ablauf reserviert (Hick's Law), und ein
 * fester Ort im Header ist trotzdem von überall erreichbar.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  showSettings = true,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  showSettings?: boolean;
}): ReactNode {
  return (
    <header className="pt-safe-4 sticky top-0 z-10 bg-canvas/90 px-4 pb-2 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-heading-24">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {showSettings && (
            <Link
              to="/settings"
              aria-label={t.nav.settings}
              className="-mr-1.5 flex size-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {/* Zahnrad (Lucide „settings“, ISC-Lizenz) */}
              <svg
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
          )}
        </div>
      </div>
      {subtitle !== undefined && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      {/* Im Kopf statt schwebend: verdeckt weder Karten noch den Erfassen-Knopf. */}
      {showSettings && <StorageNotice />}
    </header>
  );
}
