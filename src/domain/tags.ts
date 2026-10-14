import { isLive, type Task } from './types';

/**
 * Tags sind freie Schlagworte an der Aufgabe – anders als Kontexte kein eigener
 * Record: ein Tag existiert, solange eine Aufgabe ihn trägt. Das hält Anlegen reibungsfrei
 * (`#steuer` beim Erfassen genügt) und braucht weder Verwaltung noch Sync-Erweiterung.
 *
 * Groß- und Kleinschreibung zählt nicht: `#Steuer` und `#steuer` sind derselbe Tag, es
 * bleibt die zuerst verwendete Schreibweise.
 */

/** Ein Tag braucht mindestens einen Buchstaben – "Ticket #123" bleibt Titel. */
const HAS_LETTER = /\p{L}/u;

/** Bereinigt eine Eingabe zu einem Tag-Namen: ohne `#`, ohne Leerraum. Unbrauchbar → `null`. */
export function cleanTagName(raw: string): string | null {
  const name = raw.trim().replace(/^#+/, '').replace(/\s+/g, '_');
  return name !== '' && HAS_LETTER.test(name) ? name : null;
}

export const tagKey = (name: string): string => name.toLowerCase();

/** Fügt einen Tag hinzu, sofern es ihn (ohne Rücksicht auf Groß-/Kleinschreibung) noch nicht gibt. */
export function withTag(tags: readonly string[], name: string): string[] {
  const clean = cleanTagName(name);
  if (clean === null || tags.some((t) => tagKey(t) === tagKey(clean))) return [...tags];
  return [...tags, clean];
}

export function withoutTag(tags: readonly string[], name: string): string[] {
  return tags.filter((t) => tagKey(t) !== tagKey(name));
}

export const hasTag = (task: Task, name: string): boolean => task.tags.some((t) => tagKey(t) === tagKey(name));

/** Alle Tags lebender Aufgaben, alphabetisch – für Filter und Vorschläge. */
export function allTags(tasks: readonly Task[]): string[] {
  const byKey = new Map<string, string>();
  for (const task of tasks) {
    if (!isLive(task)) continue;
    for (const tag of task.tags) if (!byKey.has(tagKey(tag))) byKey.set(tagKey(tag), tag);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
