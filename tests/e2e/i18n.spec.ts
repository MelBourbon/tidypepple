import { expect, test } from '@playwright/test';

/**
 * Englische Oberfläche: folgt der Browsersprache und lässt sich in den
 * Einstellungen festlegen. Eigene Datei, weil `locale` hier bewusst nicht Deutsch ist.
 */
test.use({ locale: 'en-US' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('tidypepple');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Next' })).toBeVisible();
});

test('spricht Englisch, wenn der Browser Englisch spricht', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Quick capture' }).first().click();
  const field = page.getByRole('dialog').getByPlaceholder("What's on your mind?");
  await field.fill('Pay invoice @office !tomorrow');
  await field.press('Enter');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Pay invoice' });
  await expect(card.getByText('Tomorrow')).toBeVisible();
});

test('wechselt die Sprache in den Einstellungen und merkt sie sich', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Sprache')).toHaveValue('de');

  await page.getByLabel('Sprache').selectOption('auto');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
