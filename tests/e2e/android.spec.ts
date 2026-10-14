import { expect, test, type Page } from '@playwright/test';

/**
 * Android-App zum Direktdownload (Phase 6): dieselbe PWA, gestartet mit `/?src=android`.
 * Die echte Bridge gibt es nur in der WebView-Hülle; hier wird sie per Init-Skript
 * nachgebaut. Ohne Bridge muss alles wie im Browser laufen.
 */

const capture = async (page: Page, text: string): Promise<void> => {
  await page.getByRole('button', { name: 'Schnell erfassen' }).first().click();
  const field = page.getByRole('dialog').getByPlaceholder('Was liegt an?');
  await field.fill(text);
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
};

const resetAndOpen = async (page: Page, path: string): Promise<void> => {
  await page.goto('/');
  await page.evaluate(async () => {
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('tidypepple');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Next' })).toBeVisible();
};

test('läuft mit ?src=android ohne Bridge wie im Browser', async ({ page }) => {
  await resetAndOpen(page, '/?src=android&capture=1');
  // Der Marker verschwindet aus der Adresse, andere Parameter bleiben.
  await expect(page).toHaveURL(/\?capture=1$/);
  await page.keyboard.press('Escape');

  await capture(page, 'Paket abholen');
  await expect(page.getByText('Deine Daten liegen nur in dieser App')).toBeVisible();

  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als JSON exportieren' }).click();
  expect((await download).suggestedFilename()).toMatch(/^tidypepple-\d{4}-\d{2}-\d{2}\.json$/);
});

test('exportiert in der App über die Bridge statt per Download', async ({ page }) => {
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    let listener: ((event: { data: string }) => void) | null = null;
    Object.assign(window, {
      __bridgeSent: sent,
      TidyPeppleAndroid: {
        postMessage: (data: string) => {
          const request = JSON.parse(data) as { id: number };
          sent.push(request);
          setTimeout(() => listener?.({ data: JSON.stringify({ id: request.id, ok: true, result: { saved: true } }) }));
        },
        addEventListener: (_type: string, next: (event: { data: string }) => void) => {
          listener = next;
        },
      },
    });
  });
  // Ohne Marker: Nach einem App Link erkennt die PWA die Hülle an der Bridge.
  await resetAndOpen(page, '/');
  await capture(page, 'Steuer machen');
  await expect(page.getByText('Deine Daten liegen nur in dieser App')).toBeVisible();

  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.getByRole('button', { name: 'Als JSON exportieren' }).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __bridgeSent: { type: string }[] }).__bridgeSent.map((m) => m.type)))
    .toContain('file.save');
  const message = await page.evaluate(
    () => (window as unknown as { __bridgeSent: Record<string, string>[] }).__bridgeSent.find((m) => m['type'] === 'file.save')!,
  );
  expect(message['mimeType']).toBe('application/json');
  expect(message['encoding']).toBe('utf8');
  expect(JSON.parse(message['content']!).tasks.map((task: { title: string }) => task.title)).toContain('Steuer machen');
  expect(downloaded).toBe(false);
});

/**
 * Hülle mit `app.info`, wie Bridge.kt. Andere Nachrichten werden einfach bestätigt,
 * `notification.permission` mit „erlaubt“. Alles Gesendete landet in `window.__bridgeSent`.
 */
const installBridge = async (page: Page, versionCode: number, bridge = 1): Promise<void> => {
  await page.addInitScript(
    ([code, protocol]) => {
      const sent: unknown[] = [];
      let listener: ((event: { data: string }) => void) | null = null;
      Object.assign(window, {
        __bridgeSent: sent,
        TidyPeppleAndroid: {
          postMessage: (data: string) => {
            const request = JSON.parse(data) as { id: number; type: string };
            sent.push(request);
            const result =
              request.type === 'app.info'
                ? { versionCode: code, versionName: '2.0.0', bridge: protocol }
                : request.type === 'notification.permission'
                  ? { granted: true }
                  : {};
            setTimeout(() => listener?.({ data: JSON.stringify({ id: request.id, ok: true, result }) }));
          },
          addEventListener: (_type: string, next: (event: { data: string }) => void) => {
            listener = next;
          },
        },
      });
    },
    [versionCode, bridge] as const,
  );
};

const sentOfType = (page: Page, type: string): Promise<Record<string, unknown>[]> =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { __bridgeSent: Record<string, unknown>[] }).__bridgeSent.filter((m) => m['type'] === wanted),
    type,
  );

/** version.json der Website; zählt die Abrufe. */
const serveVersion = async (page: Page, body: Record<string, unknown>): Promise<{ count: number }> => {
  const calls = { count: 0 };
  await page.route('https://tidypepple.com/android/version.json', (route) => {
    calls.count++;
    return route.fulfill({
      json: { versionName: '2.0.1', url: 'https://tidypepple.com/android/', ...body },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return calls;
};

test('weist in der App auf eine neue APK hin, wegklicken hält', async ({ page }) => {
  await installBridge(page, 3);
  await serveVersion(page, { versionCode: 4, minVersionCode: 3 });
  await resetAndOpen(page, '/');

  const banner = page.getByRole('status').filter({ hasText: 'App-Version 2.0.1 verfügbar' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('link', { name: 'Herunterladen' })).toHaveAttribute('href', 'https://tidypepple.com/android/');

  await banner.getByRole('button', { name: 'Später' }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Next' })).toBeVisible();
  await expect(page.getByText('App-Version 2.0.1 verfügbar')).toBeHidden();
});

test('unter minVersionCode bleibt der Hinweis stehen', async ({ page }) => {
  await installBridge(page, 3);
  await serveVersion(page, { versionCode: 5, minVersionCode: 5 });
  await resetAndOpen(page, '/');

  const banner = page.getByRole('status').filter({ hasText: 'Bitte die App auf 2.0.1 aktualisieren' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Später' })).toHaveCount(0);
});

test('im Browser: keine Abfrage, kein Hinweis', async ({ page }) => {
  const calls = await serveVersion(page, { versionCode: 4 });
  await resetAndOpen(page, '/?src=android');
  await page.waitForTimeout(500);
  expect(calls.count).toBe(0);
  await expect(page.getByText('App-Version 2.0.1 verfügbar')).toBeHidden();
});

test('gleiche Version in der App: kein Hinweis', async ({ page }) => {
  await installBridge(page, 4);
  const calls = await serveVersion(page, { versionCode: 4 });
  await resetAndOpen(page, '/');
  await expect.poll(() => calls.count).toBeGreaterThan(0);
  await expect(page.getByText('App-Version 2.0.1 verfügbar')).toBeHidden();
});

test('plant Erinnerungen in der Hülle und gibt die ganze Liste weiter', async ({ page }) => {
  await installBridge(page, 4, 2);
  await resetAndOpen(page, '/');
  await capture(page, 'Blumen gießen @haus');
  await page.getByRole('link', { name: 'Blumen gießen' }).click();

  await page.getByLabel('Erinnerung', { exact: true }).fill('2099-03-04T07:15');
  await expect.poll(async () => (await sentOfType(page, 'notification.permission')).length).toBeGreaterThan(0);
  await expect
    .poll(async () => (await sentOfType(page, 'reminder.sync')).at(-1)?.['reminders'])
    .toEqual([{ id: expect.any(String), at: '2099-03-04T07:15', title: 'Blumen gießen' }]);
  // Erlaubt und nativ geplant: kein Hinweis unter dem Feld.
  await expect(page.getByText('Benachrichtigungen sind blockiert')).toBeHidden();

  await page.getByRole('button', { name: 'Erinnerung entfernen' }).click();
  await expect.poll(async () => (await sentOfType(page, 'reminder.sync')).at(-1)?.['reminders']).toEqual([]);
});

test('alte Hülle ohne Erinnerungen: Hinweis aufs Update, keine Nachricht', async ({ page }) => {
  await installBridge(page, 3, 1);
  await resetAndOpen(page, '/');
  await capture(page, 'Blumen gießen @haus');
  await page.getByRole('link', { name: 'Blumen gießen' }).click();

  await page.getByLabel('Erinnerung', { exact: true }).fill('2099-03-04T07:15');
  await expect(page.getByText('Für Erinnerungen bitte die Android-App aktualisieren.')).toBeVisible();
  expect(await sentOfType(page, 'reminder.sync')).toEqual([]);
});

test('hängt in der App geteilte Fotos und PDFs an die neue Inbox-Aufgabe (Bridge 3)', async ({ page }) => {
  // Hülle wie Bridge.kt mit einer Freigabe aus zwei Dateien; die zweite ist zu groß.
  await page.addInitScript(() => {
    const sent: { type: string }[] = [];
    let listener: ((event: { data: string }) => void) | null = null;
    const pdf = btoa('%PDF-1.4 test');
    Object.assign(window, {
      __bridgeSent: sent,
      TidyPeppleAndroid: {
        postMessage: (data: string) => {
          const request = JSON.parse(data) as { id: number; type: string; token?: string; index?: number };
          sent.push(request);
          const done = sent.some((m) => m.type === 'share.done');
          let response: Record<string, unknown> = { ok: true, result: {} };
          if (request.type === 'share.list') {
            response = done
              ? { ok: false, error: 'not-found' }
              : {
                  ok: true,
                  result: {
                    files: [
                      { name: 'Rechnung.pdf', mimeType: 'application/pdf', size: 13, tooLarge: false },
                      { name: 'Riesig.jpg', mimeType: 'image/jpeg', size: 30_000_000, tooLarge: true },
                    ],
                  },
                };
          } else if (request.type === 'share.file') {
            response = request.index === 0 && !done ? { ok: true, result: { content: pdf } } : { ok: false, error: 'not-found' };
          }
          setTimeout(() => listener?.({ data: JSON.stringify({ id: request.id, ...response }) }));
        },
        addEventListener: (_type: string, next: (event: { data: string }) => void) => {
          listener = next;
        },
      },
    });
  });
  await resetAndOpen(page, '/');

  await page.goto('/share?files=0f8e&src=android');
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText('„Riesig.jpg" ist größer als 5 MB.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rechnung.pdf' })).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __bridgeSent: { type: string }[] }).__bridgeSent.map((m) => m.type)))
    .toContain('share.done');

  // Neuladen legt nichts doppelt an: Die Freigabe ist abgeholt.
  await page.goBack();
  await page.goto('/inbox');
  await expect(page.getByRole('link', { name: 'Rechnung.pdf' })).toHaveCount(1);

  await page.getByRole('link', { name: 'Rechnung.pdf' }).click();
  await expect(page.getByRole('button', { name: 'Anhang entfernen: Rechnung.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anhang entfernen: Riesig.jpg' })).toHaveCount(0);
});
