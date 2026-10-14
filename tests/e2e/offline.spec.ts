import { expect, test, type Page } from '@playwright/test';

/**
 * Bei `registerType: 'prompt'` übernimmt ein frisch installierter Service Worker die
 * Seite erst nach der nächsten Navigation (kein `skipWaiting`). Ohne diesen Reload wäre
 * `serviceWorker.controller` beim ersten Laden immer `null`.
 */
async function withServiceWorker(page: Page): Promise<void> {
  // `ready` löst auf, sobald ein aktiver Worker den Scope bedient …
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // … kontrollieren tut er die Seite aber erst nach der nächsten Navigation.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('tidypepple');
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Next' })).toBeVisible();
});

test('legt offline an, ändert und löscht – und behält alles über einen Reload', async ({ page, context }) => {
  // Service Worker muss die Seite kontrollieren, damit der Offline-Reload die App-Shell findet.
  await withServiceWorker(page);

  await context.setOffline(true);

  await page.getByRole('button', { name: 'Schnell erfassen' }).first().click();
  const field = page.getByRole('dialog').getByPlaceholder('Was liegt an?');
  await field.fill('Offline erfasst @büro');
  await field.press('Enter');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('link', { name: 'Offline erfasst' })).toBeVisible();

  // Ändern
  await page.getByRole('link', { name: 'Offline erfasst' }).click();
  const title = page.getByPlaceholder('Titel');
  await title.fill('Offline geändert');
  await title.blur();
  await page.getByRole('navigation').getByRole('link', { name: 'Next', exact: true }).first().click();
  await expect(page.getByRole('link', { name: 'Offline geändert' })).toBeVisible();

  // Reload ohne Netz: die App-Shell kommt aus dem Service-Worker-Cache, die Daten aus IndexedDB.
  await page.reload();
  await expect(page.getByRole('link', { name: 'Offline geändert' })).toBeVisible();

  // Löschen mit Undo
  await page.getByRole('link', { name: 'Offline geändert' }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('link', { name: 'Offline geändert' })).toBeHidden();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('link', { name: 'Offline geändert' })).toBeVisible();

  await context.setOffline(false);
});

test('registriert einen Service Worker und ein Manifest (Need 12)', async ({ page }) => {
  await withServiceWorker(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    return href === undefined ? null : ((await (await fetch(href)).json()) as { name: string; display: string });
  });
  expect(manifest).toMatchObject({ name: 'TidyPepple', display: 'standalone' });
});

test('merkt sich die Sortierung über einen Reload (Recognition over Recall)', async ({ page }) => {
  await page.getByRole('combobox').first().selectOption('created');
  await page.reload();
  await expect(page.getByRole('combobox').first()).toHaveValue('created');
});
