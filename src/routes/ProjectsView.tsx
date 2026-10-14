import { Link } from 'react-router-dom';
import { DueBadge } from '@/components/DueBadge';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useGraph, useProjects } from '@/data/hooks';
import { isPausedProject, nextSteps, projectProgress } from '@/domain/projects';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';

/**
 * Die zweite Liste neben den Aktionen: Projekte als Ergebnisse, nicht als Aufgaben.
 * Ein Projekt ohne nächsten Schritt wird hervorgehoben – in GTD ist genau das der
 * Punkt, an dem Dinge liegenbleiben.
 *
 * Oben die aktiven Projekte, darunter die ruhenden (Wartet, Terminiert, Irgendwann), deren
 * Schritte noch nicht in "Next" stehen. Bei ruhenden ist ein fehlender nächster
 * Schritt kein Alarmsignal, sondern ein Projekt, das erst noch geplant wird.
 */
export function ProjectsView(): React.ReactNode {
  const graph = useGraph();
  const projects = useProjects();
  const active = projects.filter((p) => !isPausedProject(graph, p));
  const paused = projects.filter((p) => isPausedProject(graph, p));

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title={t.projects.title} />
        <EmptyState title={t.empty.projects} hint={t.empty.projectsHint} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.projects.title} subtitle={t.projects.count(projects.length)} />
      {active.length > 0 && <ProjectSection title={t.projects.active} projects={active} />}
      {paused.length > 0 && <ProjectSection title={t.projects.paused} projects={paused} />}
    </>
  );
}

function ProjectSection({ title, projects }: { title: string; projects: readonly Task[] }): React.ReactNode {
  const graph = useGraph();
  return (
    <section aria-label={title} className="pb-4">
      <h2 className="flex items-center px-4 pb-1 text-overline">
        {title}
        <span className="ml-auto tabular-nums">{projects.length}</span>
      </h2>
      {/* Einzelne Karten mit Abstand statt einer durchgehenden Liste. */}
      <ul className="flex flex-col gap-2 px-4">
        {projects.map((project) => {
          const paused = isPausedProject(graph, project);
          const progress = projectProgress(graph, project);
          const steps = nextSteps(graph, project);
          const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

          return (
            <li key={project.id} className="rounded-card border border-line bg-surface shadow-small">
              <Link to={`/task/${project.id}`} className="block px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-heading-16">{project.title}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    {paused && <span className="text-xs text-muted">{t.status[project.status]}</span>}
                    <DueBadge due={project.dueDate} time={project.dueTime} />
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {t.projects.progress(progress.done, progress.total)}
                  </span>
                </div>

                <p className="mt-1.5 truncate text-sm">
                  {progress.allDone ? (
                    <span className="text-muted">{t.projects.allDone}</span>
                  ) : progress.stalled ? (
                    <span className={paused ? 'text-muted' : 'text-danger'}>{t.projects.stalled}</span>
                  ) : (
                    <>
                      <span className="text-muted">{t.projects.nextStep}: </span>
                      {steps.map((s) => s.title).join(' · ')}
                    </>
                  )}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
