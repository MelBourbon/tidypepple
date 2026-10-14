import { describe, expect, it } from 'vitest';
import { FEEDBACK_URL, issueUrl, REPO_URL } from '@/feedback';

describe('Feedback über GitHub-Issues', () => {
  it('öffnet die Auswahl der Issue-Vorlagen', () => {
    expect(FEEDBACK_URL).toBe(`${REPO_URL}/issues/new/choose`);
  });

  it('füllt Titel, Text und Label vor und kodiert Sonderzeichen', () => {
    const url = new URL(issueUrl('Fehler in TidyPepple', 'Zeile 1\nTypeError: a & b #1'));
    expect(url.origin + url.pathname).toBe(`${REPO_URL}/issues/new`);
    expect(url.searchParams.get('title')).toBe('Fehler in TidyPepple');
    expect(url.searchParams.get('body')).toBe('Zeile 1\nTypeError: a & b #1');
    expect(url.searchParams.get('labels')).toBe('bug');
  });

  it('lässt das Label weg, wenn keins gewünscht ist', () => {
    expect(new URL(issueUrl('t', 'b', [])).searchParams.has('labels')).toBe(false);
  });
});
