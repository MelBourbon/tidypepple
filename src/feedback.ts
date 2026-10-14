/**
 * Feedback landet in den GitHub-Issues des Repositorys: Fehler, Ideen und Fragen an einer
 * Stelle, öffentlich und für alle nachlesbar.
 */
export const REPO_URL = 'https://github.com/MelBourbon/tidypepple';

/** Ziel des Feedback-Knopfs in den Einstellungen: Auswahl zwischen Fehler und Idee. */
export const FEEDBACK_URL = `${REPO_URL}/issues/new/choose`;

/**
 * Neues Issue mit vorausgefülltem Titel und Text – für „Fehler melden“ auf der Absturzseite.
 * Was in `body` steht, sieht der Nutzer auf GitHub vor dem Absenden und kann es kürzen.
 */
export function issueUrl(title: string, body: string, labels: string[] = ['bug']): string {
  const query = new URLSearchParams({ title, body });
  if (labels.length > 0) query.set('labels', labels.join(','));
  return `${REPO_URL}/issues/new?${query.toString()}`;
}
