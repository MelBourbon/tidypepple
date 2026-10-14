import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { issueUrl } from '@/feedback';
import { t } from '@/i18n';
import { platform } from '@/platform';
import { reportError, type ErrorKind } from '@/telemetry';

/**
 * Was „Fehler melden“ ins Issue schreibt. Anders als der anonyme Ping darf hier die
 * Meldung stehen: Der Nutzer sieht den Text auf GitHub, bevor er ihn abschickt, und der
 * Hinweis im Text bittet, Privates vorher zu entfernen.
 */
export function crashDetails(error: unknown, path: string): string {
  const lines = [`Version: ${__APP_VERSION__}`, `Plattform: ${platform()}`, `Seite: ${path}`];
  if (error instanceof Error) {
    lines.push(`${error.name}: ${error.message}`);
    // Die ersten Zeilen reichen, um die Stelle zu finden; eine ganze Spur sprengt die URL.
    const stack = error.stack?.split('\n').slice(1, 6).map((l) => l.trim());
    if (stack !== undefined && stack.length > 0) lines.push(...stack);
  } else {
    lines.push(String(error));
  }
  return lines.join('\n');
}

function Screen({ title, body, children }: { title: string; body: string; children: React.ReactNode }): React.ReactNode {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-heading-20">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap gap-3">{children}</div>
    </main>
  );
}

const PRIMARY =
  'inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover';
const SECONDARY =
  'inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised';

/**
 * Statt der Standardseite von React Router oder einer weißen Seite: beruhigen, neu laden
 * lassen, und das Melden so einfach machen wie möglich.
 */
export function ErrorScreen({ error, kind }: { error: unknown; kind: ErrorKind }): React.ReactNode {
  useEffect(() => reportError(kind, error), [kind, error]);
  const report = issueUrl(t.crash.reportSubject, t.crash.reportBody(crashDetails(error, window.location.pathname)));

  return (
    <Screen title={t.crash.title} body={t.crash.body}>
      <button type="button" onClick={() => window.location.reload()} className={PRIMARY}>
        {t.crash.reload}
      </button>
      <a href={report} target="_blank" rel="noreferrer noopener" className={SECONDARY}>
        {t.crash.report}
      </a>
    </Screen>
  );
}

/** `errorElement` des Routers: unbekannte Adresse oder Fehler beim Rendern einer Ansicht. */
export function RouteError(): React.ReactNode {
  const error = useRouteError();
  // Eine unbekannte Adresse ist kein Programmfehler – nicht melden.
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <Screen title={t.crash.notFound} body={t.crash.notFoundBody}>
        {/* Bewusst kein <Link>: ein frischer Seitenaufruf setzt auch kaputten Zustand zurück. */}
        <a href="/" className={PRIMARY}>
          {t.crash.home}
        </a>
      </Screen>
    );
  }
  return <ErrorScreen error={error} kind="render" />;
}
