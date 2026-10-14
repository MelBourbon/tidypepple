import { purgeOrphanBlobs } from './attachments';
import { t } from '@/i18n';
import { db } from './db';
import { createContext, initRepo, purgeLocalTombstones } from './repo';

/**
 * Aufbewahrungsfrist für lokale Tombstones. Der Server behält die Löschung ohnehin für
 * immer (siehe `records.deleted` in 0001_schema.sql); hier geht es nur um Platz auf dem Gerät.
 */
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function bootstrap(): Promise<void> {
  await initRepo();
  if ((await db.contexts.count()) === 0 && (await db.tasks.count()) === 0) {
    // Erster Start: ein paar Kontexte, damit die Filterleiste nicht leer ist und der
    // GTD-Gedanke "Kontext" sofort sichtbar wird. Wer sie nicht mag, löscht sie.
    for (const name of t.defaultContexts) await createContext(name);
  }
  // Ohne diese Zusage darf der Browser IndexedDB bei Speicherdruck löschen – für eine
  // Offline-First-App wäre das Datenverlust.
  if (navigator.storage?.persist !== undefined && !(await navigator.storage.persisted())) {
    await navigator.storage.persist();
  }

  // Lange erledigte Löschungen belegen sonst dauerhaft Platz auf dem Gerät. Records, die
  // noch in der Outbox stehen, bleiben verschont – ihre Löschung kennt noch niemand sonst.
  await purgeLocalTombstones(TOMBSTONE_RETENTION_MS);
  // Danach: Dateien, deren Aufgabe gerade endgültig weggeräumt wurde oder deren Anhang
  // entfernt ist, belegen sonst unsichtbar Platz.
  await purgeOrphanBlobs();
}
