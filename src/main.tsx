import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/Toast';
import { SyncProvider } from './sync/SyncProvider';
import { bootstrap } from './data/bootstrap';
import { BoardView } from './routes/BoardView';
import { DoneView } from './routes/DoneView';
import { ListView } from './routes/ListView';
import { ProjectsView } from './routes/ProjectsView';
import { SettingsView } from './routes/SettingsView';
import { ShareView } from './routes/ShareView';
import { InboxView } from './routes/StatusView';
import { TaskDetail } from './routes/TaskDetail';
import { locale } from './i18n';
import { applyTextSize, readTextSize } from './ui/textSize';
import { watchErrors, watchInstall } from './telemetry';
import { ErrorScreen, RouteError } from './components/ErrorScreen';
import { initPlatform } from './platform';
import { initCheckoutReturn } from './billing/checkoutReturn';
import './ui/tokens.css';

// index.html sagt 'de'; Screenreader und Silbentrennung brauchen die tatsächliche Sprache.
document.documentElement.lang = locale;
// Vor dem Router: nimmt `?src=…` und `?checkout=done` aus der Adresse, bevor eine Route sie sieht.
initPlatform();
initCheckoutReturn();
// Vor dem ersten Rendern, sonst springt die Schrift nach dem Start.
applyTextSize(readTextSize());
watchErrors();
watchInstall();

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // Ersetzt die Standardseite von React Router: bei einem Absturz einer Ansicht und bei
    // unbekannten Adressen.
    errorElement: <RouteError />,
    children: [
      // `key`: ohne ihn übernähme "All" beim Wechsel den Zustand (Suche) von "Next".
      { index: true, element: <ListView key="next" scope="next" /> },
      { path: 'all', element: <ListView key="all" scope="all" /> },
      { path: 'inbox', element: <InboxView /> },
      { path: 'done', element: <DoneView /> },
      { path: 'share', element: <ShareView /> },
      // Alte Lesezeichen: "Wartet" ist jetzt ein Abschnitt von "All".
      { path: 'waiting', element: <Navigate to="/all" replace /> },
      { path: 'projects', element: <ProjectsView /> },
      // Projekte und Aufgaben teilen sich die Detailansicht – im Modell sind sie dasselbe.
      { path: 'projects/:id', element: <TaskDetail /> },
      { path: 'task/:id', element: <TaskDetail /> },
      { path: 'board', element: <BoardView /> },
      { path: 'settings', element: <SettingsView /> },
    ],
  },
]);

const root = createRoot(document.getElementById('root')!);

bootstrap().then(
  () => {
    root.render(
      <StrictMode>
        <SyncProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </SyncProvider>
      </StrictMode>,
    );
  },
  // Etwa IndexedDB gesperrt (privater Modus, voller Speicher): sonst bliebe die Seite weiß.
  (cause: unknown) => root.render(<ErrorScreen error={cause} kind="startup" />),
);
