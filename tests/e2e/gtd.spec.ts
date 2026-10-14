import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-End entlang der User Needs. Jeder Test benennt, welches Bedürfnis er absichert.
 */

/**
 * Navigation über die Navigationslandmarke und mit exaktem Namen. Ohne beides matcht
 * `getByRole('link', { name: 'Board' })` als Teilstring auch eine Karte namens "Board-Karte".
 */
const go = async (page: Page, label: string): Promise<void> => {
  await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).first().click();
};

const capture = async (page: Page, text: string): Promise<void> => {
  await page.getByRole('button', { name: 'Schnell erfassen' }).first().click();
  const field = page.getByRole('dialog').getByPlaceholder('Was liegt an?');
  await field.fill(text);
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Jeder Test startet mit leerer Datenbank – sonst hängen die Tests voneinander ab.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('tidypepple');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Next' })).toBeVisible();
});

test('erfasst eine Aufgabe und zeigt sie in der Liste (Need 1)', async ({ page }) => {
  await capture(page, 'Rechnung bezahlen @büro');
  await expect(page.getByRole('link', { name: 'Rechnung bezahlen' })).toBeVisible();
  // Auf der Karte, nicht in der Filterleiste – deshalb auf den Listeneintrag eingegrenzt.
  await expect(page.getByRole('listitem').getByText('@büro')).toBeVisible();
});

test('filtert die Liste nach Kontext (Need 2)', async ({ page }) => {
  await capture(page, 'Anruf bei Bob @telefon');
  await capture(page, 'Ablage sortieren @büro');

  // Ein Chip mit aufklappbarer Mehrfachauswahl statt einer Chipzeile je Kontext.
  await page.getByRole('button', { name: 'Kontext', exact: true }).click();
  await page.getByRole('checkbox', { name: '@telefon' }).click();
  await expect(page.getByRole('link', { name: 'Anruf bei Bob' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Kontext: @telefon' })).toBeVisible();

  // Mehrere Kontexte verknüpft ODER.
  await page.getByRole('checkbox', { name: '@büro' }).click();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Anruf bei Bob' })).toBeVisible();

  await page.getByRole('checkbox', { name: '@büro' }).click();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeHidden();
  await page.getByRole('button', { name: 'Alle Kontexte zeigen' }).click();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kontext', exact: true })).toBeVisible();
});

test('vergibt Tags, sucht und filtert nach ihnen; + legt das Projekt fest', async ({ page }) => {
  await capture(page, 'Belege sortieren @büro #steuer');
  await capture(page, 'Kiste packen @zuhause +Umzug #privat');
  await capture(page, 'Ablage machen @büro');

  // `+` legt das Projekt an, `#` wird zum Tag auf der Karte.
  await expect(page.getByRole('listitem').getByText('#steuer')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Umzug', exact: true })).toBeVisible();

  // Im Detail nachträglich einen Tag vergeben.
  await page.getByRole('link', { name: 'Ablage machen' }).click();
  await page.getByRole('button', { name: 'Tag', exact: true }).click();
  const tagField = page.getByRole('textbox', { name: 'Tag suchen oder neu anlegen' });
  // Vorhandener Tag in anderer Schreibweise: wird gewählt, nicht doppelt angelegt.
  await tagField.fill('#Steuer');
  await tagField.press('Enter');
  await expect(page.getByRole('button', { name: 'Tag: steuer' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Schließen' }).click();

  await page.getByRole('button', { name: 'Tag', exact: true }).click();
  await page.getByRole('checkbox', { name: '#steuer' }).click();
  await expect(page.getByRole('link', { name: 'Belege sortieren' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ablage machen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kiste packen' })).toBeHidden();
  await page.getByRole('button', { name: 'Alle Tags zeigen' }).click();

  await page.getByRole('searchbox').fill('#pri');
  await expect(page.getByRole('link', { name: 'Kiste packen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Belege sortieren' })).toBeHidden();
});

test('ordnet im Detail Kontext, Tags und Projekt über kompakte Chips zu', async ({ page }) => {
  await capture(page, 'Ablage machen @büro');
  await capture(page, 'Kartons kaufen +Umzug');
  await capture(page, 'Online bestellen');

  await go(page, 'Inbox');
  await page.getByRole('link', { name: 'Online bestellen' }).click();
  // Ohne Zuordnung nennt der Chip nur das Feld.
  const contextChip = page.getByRole('button', { name: 'Kontext', exact: true });
  await expect(contextChip).toBeVisible();
  await contextChip.click();
  await page.getByRole('checkbox', { name: '@büro' }).click();
  const contextField = page.getByRole('textbox', { name: 'Kontext suchen oder neu anlegen' });
  await contextField.fill('@online');
  await page.getByRole('button', { name: '„@online“ anlegen' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Kontext: büro, online' })).toHaveText(/@büro \+1/);

  // Neues Projekt aus dem Textfeld, dann ein vorhandenes wählen.
  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
  const projectField = page.getByRole('textbox', { name: 'Projekt suchen oder neu anlegen' });
  await projectField.fill('Garten');
  await projectField.press('Enter');
  await expect(page.getByRole('button', { name: 'Projekt: Garten' })).toHaveText(/\+Garten/);
  await page.getByRole('button', { name: 'Projekt: Garten' }).click();
  await page.getByRole('radio', { name: '+Umzug' }).click();
  await expect(page.getByRole('button', { name: 'Projekt: Umzug' })).toBeVisible();

  // „Projekt öffnen“ führt zum Projekt, dessen Schritt die Aufgabe jetzt ist.
  await page.getByRole('button', { name: 'Projekt: Umzug' }).click();
  await page.getByRole('link', { name: 'Projekt öffnen' }).click();
  await expect(page.getByPlaceholder('Titel')).toHaveValue('Umzug');
  await expect(page.getByRole('link', { name: 'Online bestellen' })).toBeVisible();

  // Die Liste zeigt die Kontexte unverändert einzeln.
  await go(page, 'All');
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Online bestellen' }) });
  await expect(row.getByText('@büro')).toBeVisible();
  await expect(row.getByText('@online')).toBeVisible();
});

test('öffnet die eben erfasste Aufgabe, ohne das Runterschreiben zu stören', async ({ page }) => {
  await page.getByRole('button', { name: 'Schnell erfassen' }).first().click();
  const field = page.getByRole('dialog').getByPlaceholder('Was liegt an?');
  await field.fill('Erste @büro');
  await field.press('Enter');
  await field.fill('Zweite @büro');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();

  await page.getByRole('link', { name: '„Zweite“ bearbeiten' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Zweite');
  await page.getByPlaceholder('Gedanken, Links, Details …').fill('Mit Notiz');
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByRole('link', { name: 'Erste' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zweite' })).toBeVisible();

  // Strg+Enter speichert und öffnet in einem Schritt.
  await page.getByRole('button', { name: 'Schnell erfassen' }).first().click();
  await field.fill('Dritte @büro');
  await field.press('Control+Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Dritte');
});

test('markiert Aufgaben als wichtig und filtert auf sie', async ({ page }) => {
  await capture(page, 'Steuer abgeben @büro !!');
  await capture(page, 'Ablage sortieren @büro');
  await expect(page.getByRole('link', { name: 'Wichtig: Steuer abgeben' })).toBeVisible();

  // Im Detail nachträglich markieren.
  await page.getByRole('link', { name: 'Ablage sortieren' }).click();
  await page.getByRole('button', { name: 'Wichtig' }).click();
  await expect(page.getByRole('button', { name: 'Wichtig' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Schließen' }).click();

  await capture(page, 'Blumen gießen @büro');
  await page.getByRole('button', { name: 'Nur wichtige' }).click();
  await expect(page.getByRole('link', { name: 'Steuer abgeben' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Blumen gießen' })).toBeHidden();

  await page.getByRole('button', { name: 'Nur wichtige' }).click();
  await expect(page.getByRole('link', { name: 'Blumen gießen' })).toBeVisible();
});

test('sortiert nach Fälligkeit und zeigt das Datum in der Liste (Needs 3, 5)', async ({ page }) => {
  await capture(page, 'Später fällig @büro !+10');
  await capture(page, 'Heute fällig @büro !heute');

  await expect(page.getByText('Heute', { exact: true })).toBeVisible();
  const titles = await page.getByRole('link', { name: /fällig/ }).allInnerTexts();
  expect(titles).toEqual(['Heute fällig', 'Später fällig']);
});

test('entfernt ein gesetztes Fälligkeitsdatum wieder', async ({ page }) => {
  await capture(page, 'Steuer machen @büro !heute');
  await page.getByRole('link', { name: 'Steuer machen' }).click();

  const due = page.getByLabel('Fällig am', { exact: true });
  await expect(due).not.toHaveValue('');
  await page.getByRole('button', { name: 'Fällig am entfernen' }).click();
  await expect(due).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Fällig am entfernen' })).toBeHidden();

  await page.reload();
  await expect(page.getByLabel('Fällig am', { exact: true })).toHaveValue('');
});

test('Fällig und Sichtbar ab nebeneinander, Erinnerung mit Uhrzeit darunter – auch bei 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await capture(page, 'Zahnarzt anrufen @telefon !heute >heute');
  await page.getByRole('link', { name: 'Zahnarzt anrufen' }).click();

  const due = (await page.getByLabel('Fällig am', { exact: true }).boundingBox())!;
  const defer = (await page.getByLabel('Sichtbar ab', { exact: true }).boundingBox())!;
  expect(Math.abs(due.y - defer.y)).toBeLessThan(1);
  expect(due.x + due.width).toBeLessThan(defer.x);
  // Beide Entfernen-Knöpfe sind sichtbar und liegen innerhalb des Bildschirms.
  const clearDefer = (await page.getByRole('button', { name: 'Sichtbar ab entfernen' }).boundingBox())!;
  expect(clearDefer.x + clearDefer.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  const reminder = page.getByLabel('Erinnerung', { exact: true });
  expect((await reminder.boundingBox())!.y).toBeGreaterThan(due.y + due.height);
  await reminder.fill('2099-01-02T09:30');
  await page.reload();
  await expect(page.getByLabel('Erinnerung', { exact: true })).toHaveValue('2099-01-02T09:30');

  // In der Liste steht die Glocke mit der Uhrzeit.
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByRole('listitem').getByText('09:30')).toBeVisible();

  await page.getByRole('link', { name: 'Zahnarzt anrufen' }).click();
  await page.getByRole('button', { name: 'Erinnerung entfernen' }).click();
  await expect(page.getByLabel('Erinnerung', { exact: true })).toHaveValue('');
});

/** Vertikale Mitte der ersten Textzeile bzw. des Knopfs, in Seitenpixeln. */
const firstLineCenter = (el: Element): number => {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2;
};

test('Titel steht mittig zum Erledigt-Knopf – in der Liste und im Detail', async ({ page }) => {
  // Ohne Kontext und Datum landet die Aufgabe in der Inbox, nur mit Titel.
  await capture(page, 'Nackter Titel');
  await go(page, 'Inbox');

  const row = page.locator('[data-task-row]', { hasText: 'Nackter Titel' });
  const rowButton = page.locator('.group', { has: row }).getByRole('checkbox');
  const rowText = await row.evaluate(firstLineCenter);
  const rowBox = (await rowButton.boundingBox())!;
  expect(Math.abs(rowText - (rowBox.y + rowBox.height / 2))).toBeLessThan(1);

  await row.click();
  const title = page.getByRole('textbox', { name: 'Titel' });
  const titleText = await title.evaluate(firstLineCenter);
  const detailBox = (await page.getByRole('checkbox', { name: 'Erledigt' }).first().boundingBox())!;
  expect(Math.abs(titleText - (detailBox.y + detailBox.height / 2))).toBeLessThan(1);
});

test('kein grüner Fokusrahmen in den randlosen Eingabefeldern', async ({ page }) => {
  await capture(page, 'Umzug @büro');
  await page.getByRole('link', { name: 'Umzug' }).click();
  const step = page.getByPlaceholder('Schritt hinzufügen');
  await step.click();
  await step.pressSequentially('Kartons');
  await expect(step).toHaveCSS('outline-style', 'none');

  await page.goto('/settings');
  const context = page.getByPlaceholder('Neuer Kontext');
  await context.click();
  await context.pressSequentially('garten');
  await expect(context).toHaveCSS('outline-style', 'none');

  // Tastaturfokus auf Knöpfen bleibt sichtbar.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus-visible')).toHaveCSS('outline-style', 'solid');
});

test('macht schon aus einem Schritt ein Projekt und zeigt nur den nächsten Schritt (Needs 8, 9, 10)', async ({ page }) => {
  await capture(page, 'Umzug planen @büro');
  await page.getByRole('link', { name: 'Umzug planen' }).click();

  const stepField = page.getByPlaceholder('Schritt hinzufügen');
  await stepField.fill('Kartons kaufen');
  await stepField.press('Enter');
  await expect(page.getByText('„Umzug planen" ist jetzt ein Projekt')).toBeVisible();
  await stepField.fill('Transporter mieten');
  await stepField.press('Enter');

  await go(page, 'Next');
  // Das Projekt selbst verschwindet aus der Aktionsliste, nur der erste Schritt bleibt.
  await expect(page.getByRole('link', { name: 'Kartons kaufen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Transporter mieten' })).toBeHidden();
  // Das Projekt ist keine Zeile mehr (Zeilentitel verlinken auf /task/…); der Projekt-Chip
  // auf der Schritt-Karte zeigt dagegen weiterhin dorthin – das ist Absicht, siehe Need 11.
  await expect(page.locator('a[href^="/task/"]', { hasText: 'Umzug planen' })).toHaveCount(0);

  // ... und taucht in der Projektliste auf (Need 10).
  await go(page, 'Projekte');
  await expect(page.getByRole('region', { name: 'Aktiv' }).getByRole('link', { name: /Umzug planen/ })).toBeVisible();
  await expect(page.getByText('Nächster Schritt:')).toBeVisible();
});

test('navigiert vom nächsten Schritt zum Projekt (Need 11)', async ({ page }) => {
  await capture(page, 'Website starten @rechner');
  await page.getByRole('link', { name: 'Website starten' }).click();
  const stepField = page.getByPlaceholder('Schritt hinzufügen');
  await stepField.fill('Domain kaufen');
  await stepField.press('Enter');
  await stepField.fill('Texte schreiben');
  await stepField.press('Enter');

  await go(page, 'Next');
  // Auf der Karte des nächsten Schritts führt der Projekt-Chip zurück zum Projekt.
  await page.getByRole('link', { name: 'Website starten' }).click();
  await expect(page.getByPlaceholder('Titel')).toHaveValue('Website starten');
  await expect(page.getByRole('link', { name: 'Domain kaufen' })).toBeVisible();
});

test('plant ein Irgendwann-Projekt, ohne dass seine Schritte in "Next" landen', async ({ page }) => {
  await capture(page, 'Balkon bepflanzen @zuhause');
  await page.getByRole('link', { name: 'Balkon bepflanzen' }).click();
  const stepField = page.getByPlaceholder('Schritt hinzufügen');
  await stepField.fill('Töpfe kaufen');
  await stepField.press('Enter');
  await stepField.fill('Erde holen');
  await stepField.press('Enter');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('someday');
  // Der erste: der Hinweis „… ist jetzt ein Projekt" hat ebenfalls einen Schließen-Knopf (×).
  await page.getByRole('button', { name: 'Schließen' }).first().click();

  await go(page, 'Next');
  await expect(page.getByRole('link', { name: 'Töpfe kaufen' })).toBeHidden();

  // In "All" steht das Projekt selbst unter "Irgendwann" – als Projekt gekennzeichnet, ohne seine Schritte.
  await go(page, 'All');
  const project = page
    .getByRole('region', { name: 'Irgendwann' })
    .getByRole('listitem')
    .filter({ has: page.locator('a[href^="/task/"]', { hasText: 'Balkon bepflanzen' }) });
  await expect(project.getByText('Projekt · 0/2 erledigt')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Töpfe kaufen' })).toBeHidden();

  // In der Projektansicht steht es unten unter "Ruhend", nicht bei den aktiven.
  await go(page, 'Projekte');
  await expect(page.getByRole('region', { name: 'Ruhend' }).getByRole('link', { name: /Balkon bepflanzen/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aktiv' })).toHaveCount(0);
});

test('speichert einen Entwurf bei "Zurück" in die richtige Aufgabe', async ({ page }) => {
  await capture(page, 'Garten anlegen @zuhause');
  await page.getByRole('link', { name: 'Garten anlegen' }).click();
  const stepField = page.getByPlaceholder('Schritt hinzufügen');
  await stepField.fill('Beete planen');
  await stepField.press('Enter');
  await page.getByRole('link', { name: 'Beete planen' }).click();

  // Tippen und sofort zurück – ohne dass das Feld den Fokus verliert und ohne die
  // Speicherpause abzuwarten. Die Detailansicht bleibt dabei dieselbe Route.
  const title = page.getByPlaceholder('Titel');
  await expect(title).toHaveValue('Beete planen');
  await title.fill('Beete planen und umgraben');
  await page.goBack();

  await expect(title).toHaveValue('Garten anlegen');
  await page.waitForTimeout(800);
  await expect(title).toHaveValue('Garten anlegen');
  await expect(page.getByRole('link', { name: 'Beete planen und umgraben' })).toBeVisible();
});

test('legt Unklares in die Inbox und Geklärtes direkt in die Liste', async ({ page }) => {
  await capture(page, 'Nur so ein Gedanke');
  await capture(page, 'Schon geklärt @büro');

  // Ohne Kontext und Datum ist eine Erfassung ungeklärt – sie gehört in die Inbox.
  await expect(page.getByRole('link', { name: 'Nur so ein Gedanke' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Schon geklärt' })).toBeVisible();

  await go(page, 'Inbox');
  await expect(page.getByRole('link', { name: 'Nur so ein Gedanke' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Schon geklärt' })).toBeHidden();
});

test('erledigt eine Aufgabe und macht das rückgängig', async ({ page }) => {
  await capture(page, 'Müll rausbringen @zuhause');
  await page.getByRole('checkbox', { name: 'Erledigt' }).click();
  await expect(page.getByRole('link', { name: 'Müll rausbringen' })).toBeHidden();

  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('link', { name: 'Müll rausbringen' })).toBeVisible();
});

test('zeigt Erledigtes, öffnet es wieder und löscht es endgültig', async ({ page }) => {
  await capture(page, 'Müll rausbringen @zuhause');
  await capture(page, 'Blumen gießen @zuhause');
  await capture(page, 'Steuer abgeben @büro');
  for (const title of ['Müll rausbringen', 'Blumen gießen', 'Steuer abgeben']) {
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('checkbox').click();
  }

  await go(page, 'All');
  await page.getByRole('link', { name: 'Erledigt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Erledigt', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Steuer abgeben' })).toBeVisible();
  // Wann abgehakt wurde, steht klein mit Datum und Uhrzeit an der Karte.
  await expect(page.getByRole('listitem').filter({ hasText: 'Steuer abgeben' }).locator('time')).toHaveText(/^Erledigt .*\d{2}:\d{2}$/);
  await page.screenshot({ path: 'test-results/done-stamp.png' });

  // Wieder öffnen: verschwindet hier und steht wieder in "Next".
  await page.getByRole('listitem').filter({ hasText: 'Steuer abgeben' }).getByRole('checkbox').click();
  await expect(page.getByRole('link', { name: 'Steuer abgeben' })).toBeHidden();

  // Einzeln löschen, mit Undo.
  await page.getByRole('button', { name: 'Löschen: Müll rausbringen' }).click();
  await expect(page.getByRole('link', { name: 'Müll rausbringen' })).toBeHidden();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('link', { name: 'Müll rausbringen' })).toBeVisible();

  await page.getByRole('button', { name: 'Alle löschen' }).click();
  await expect(page.getByText('Noch nichts erledigt.')).toBeVisible();

  await go(page, 'Next');
  await expect(page.getByRole('link', { name: 'Steuer abgeben' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Müll rausbringen' })).toBeHidden();
});

test('legt geteilten Text als Inbox-Eintrag an, genau einmal', async ({ page }) => {
  const text = 'Artikel über GTD lesen\nhttps://example.com/gtd';
  await page.goto(`/share?text=${encodeURIComponent(text)}`);
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText('In der Inbox gespeichert')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Artikel über GTD lesen' })).toHaveCount(1);

  // Neuladen und Zurück dürfen die Freigabe nicht noch einmal anlegen.
  await page.reload();
  await page.goBack();
  await page.goto('/inbox');
  await expect(page.getByRole('link', { name: 'Artikel über GTD lesen' })).toHaveCount(1);

  await page.getByRole('link', { name: 'Artikel über GTD lesen' }).click();
  await expect(page.getByText('https://example.com/gtd')).toBeVisible();
});

test('hängt Bilder und PDFs an, verkleinert Fotos und hält die Größengrenze ein', async ({ page }) => {
  await capture(page, 'Rechnung prüfen @büro');
  await page.getByRole('link', { name: 'Rechnung prüfen' }).click();

  // Ein "Handyfoto" mit 4000 px Kantenlänge, im Browser erzeugt.
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, 4000, 3000);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const input = page.locator('input[type="file"][accept^="image"]');
  await input.setInputFiles([
    { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(photo) },
    { name: 'rechnung.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
  ]);

  const image = page.getByRole('img', { name: 'foto.jpg' });
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2560);
  await expect(page.getByRole('link', { name: 'rechnung.pdf' })).toBeVisible();

  // Zu groß: abgelehnt, mit Begründung.
  await input.setInputFiles({ name: 'riesig.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(6 * 1024 * 1024) });
  await expect(page.getByText('„riesig.pdf" ist größer als 5 MB.')).toBeVisible();

  // Entfernen mit Undo.
  await page.getByRole('button', { name: 'Anhang entfernen: rechnung.pdf' }).click();
  await expect(page.getByRole('link', { name: 'rechnung.pdf' })).toBeHidden();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByRole('link', { name: 'rechnung.pdf' })).toBeVisible();

  // Überlebt ein Neuladen, und die Liste zeigt die Büroklammer.
  await page.reload();
  await expect(page.getByRole('img', { name: 'foto.jpg' })).toBeVisible();
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Rechnung prüfen' }).getByText('2 Anhänge')).toBeAttached();
});

test('zeigt dieselben Aufgaben mit Datum im Board (Needs 4, 5)', async ({ page }) => {
  await capture(page, 'Board-Karte @büro !heute');

  await go(page, 'Board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  const column = page.getByRole('region', { name: 'Nächste Aktion' });
  await expect(column.getByRole('link', { name: 'Board-Karte' })).toBeVisible();
  await expect(column.getByText('Heute', { exact: true })).toBeVisible();
});

test('hält lange Labels im Board innerhalb der Karte', async ({ page }) => {
  await capture(page, 'Angebot einholen @büro_und_verwaltung_beim_finanzamt #steuererklärung_mit_allen_belegen');
  await page.getByRole('link', { name: 'Angebot einholen' }).click();
  await page.getByRole('combobox').first().selectOption('waiting');
  await page.getByPlaceholder('Wen oder was?').fill('Handwerker Müller und Söhne GmbH');
  await page.getByRole('button', { name: 'Schließen' }).click();
  await go(page, 'Board');

  const card = page.locator('li').filter({ has: page.getByRole('link', { name: 'Angebot einholen' }) });
  const box = (await card.boundingBox())!;
  for (const label of [/Wartet auf/, /@büro_und/, /#steuererklärung/]) {
    const badge = (await card.getByText(label).first().boundingBox())!;
    expect(badge.x + badge.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
});

test('gruppiert das Board nach Kontext', async ({ page }) => {
  await capture(page, 'Telefonat führen @telefon');
  await go(page, 'Board');
  // Über den Namen: `.first()` erwischte sonst manchmal noch die Sortierung der Liste.
  await page.getByRole('combobox', { name: 'Spalten' }).selectOption('context');
  await expect(page.getByRole('region', { name: '@telefon' }).getByRole('link', { name: 'Telefonat führen' })).toBeVisible();
});

test('scrollt lange Board-Spalten für sich, die Seite bleibt stehen', async ({ page }) => {
  for (let i = 1; i <= 20; i++) await capture(page, `Karte ${i}`);
  await go(page, 'Board');
  await page.setViewportSize({ width: 900, height: 600 });

  // Die Seite selbst scrollt nicht – sonst läge die horizontale Scrollleiste unter den Karten.
  const [docHeight, viewport] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
  expect(docHeight).toBeLessThanOrEqual(viewport!);
  const list = page.getByRole('list').filter({ has: page.getByRole('link', { name: 'Karte 1', exact: true }) });
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test('verbreitert Board-Spalten auf breiten Bildschirmen, höchstens auf das Doppelte', async ({ page }) => {
  await capture(page, 'Breite Karte');
  await go(page, 'Board');
  const column = page.getByRole('region').filter({ has: page.getByRole('link', { name: 'Breite Karte' }) });

  await page.setViewportSize({ width: 3600, height: 800 });
  expect((await column.boundingBox())!.width).toBeCloseTo(512, 0);
  await page.setViewportSize({ width: 1000, height: 800 });
  expect((await column.boundingBox())!.width).toBeCloseTo(256, 0);
});

test('sagt ohne eingerichteten Sync ehrlich, dass Daten nur lokal liegen (Need 7/14)', async ({ page }) => {
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  // Der Indikator steht auch in der Seitenleiste – hier ist der in der Ansicht gemeint.
  await expect(page.getByRole('main').getByText('Nur auf diesem Gerät')).toBeVisible();
  await expect(page.getByText('Kein Supabase-Projekt hinterlegt', { exact: false })).toBeVisible();
});

test('verwaltet Kontexte in den Einstellungen', async ({ page }) => {
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  const field = page.getByPlaceholder('Neuer Kontext');
  await field.fill('werkstatt');
  await field.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Kontext werkstatt' })).toBeVisible();

  await page.getByRole('button', { name: 'Löschen: @werkstatt' }).click();
  await expect(page.getByRole('textbox', { name: 'Kontext werkstatt' })).toBeHidden();
});

test('ordnet Kontexte in den Einstellungen – Liste und Board folgen', async ({ page }) => {
  await capture(page, 'Zettel sortieren @büro');
  await capture(page, 'Bob anrufen @telefon @büro');

  // Wie viele Standardkontexte davor stehen, hängt vom Start ab – also bis ganz nach oben
  // klicken, statt Positionen anzunehmen.
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  const up = page.getByRole('button', { name: '@telefon nach oben' });
  await expect(async () => {
    if (await up.isEnabled()) await up.click({ timeout: 500 });
    await expect(up).toBeDisabled({ timeout: 500 });
  }).toPass();
  await expect(page.getByRole('textbox', { name: /^Kontext / }).first()).toHaveValue('telefon');

  // Kontextfilter: @telefon steht jetzt vorn.
  await go(page, 'Next');
  await page.getByRole('button', { name: 'Kontext', exact: true }).click();
  await expect(page.getByRole('checkbox').first()).toHaveAccessibleName('@telefon');
  await page.keyboard.press('Escape');

  // Board: @telefon ist die erste Spalte, und die Aufgabe mit beiden Kontexten liegt dort.
  await go(page, 'Board');
  // Über den Namen: `.first()` erwischte sonst manchmal noch die Sortierung der Liste.
  await page.getByRole('combobox', { name: 'Spalten' }).selectOption('context');
  await expect(page.getByRole('region', { name: '@telefon' })).toBeVisible();
  await expect(page.getByRole('region').first()).toHaveAccessibleName('@telefon');
  await expect(page.getByRole('region', { name: '@telefon' }).getByRole('link', { name: 'Bob anrufen' })).toBeVisible();
});

test('gliedert die Liste nach Kontext und klappt Abschnitte ein', async ({ page }) => {
  await capture(page, 'Bob anrufen @telefon');
  await capture(page, 'Ablage sortieren @büro');

  await page.getByRole('combobox', { name: 'Sortieren' }).selectOption('context');
  const telefon = page.getByRole('region', { name: '@telefon' });
  await expect(telefon.getByRole('link', { name: 'Bob anrufen' })).toBeVisible();
  await expect(page.getByRole('region', { name: '@büro' }).getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();

  // Einklappen blendet nur diesen Abschnitt aus – und übersteht einen Neustart.
  await page.getByRole('button', { name: '@telefon einklappen' }).click();
  await expect(page.getByRole('link', { name: 'Bob anrufen' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bob anrufen' })).toBeHidden();

  await page.getByRole('button', { name: '@telefon aufklappen' }).click();
  await expect(page.getByRole('link', { name: 'Bob anrufen' })).toBeVisible();

  // Andere Sortierungen bleiben eine durchgehende Liste.
  await page.getByRole('combobox', { name: 'Sortieren' }).selectOption('due');
  await expect(page.getByRole('region', { name: '@telefon' })).toBeHidden();
});

test('gliedert die Liste nach Status', async ({ page }) => {
  await capture(page, 'Bob anrufen @telefon');
  await capture(page, 'Zahnarzt @telefon');
  await page.getByRole('link', { name: 'Zahnarzt' }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('scheduled');
  await page.getByRole('button', { name: 'Schließen' }).click();

  await page.getByRole('combobox', { name: 'Sortieren' }).selectOption('status');
  await expect(
    page.getByRole('region', { name: 'Nächste Aktion' }).getByRole('link', { name: 'Bob anrufen' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Terminiert' }).getByRole('link', { name: 'Zahnarzt' })).toBeVisible();

  // Eingeklappt bleibt eingeklappt – auch über einen Neustart.
  await page.getByRole('button', { name: 'Terminiert einklappen' }).click();
  await expect(page.getByRole('link', { name: 'Zahnarzt' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Zahnarzt' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Bob anrufen' })).toBeVisible();
});

test('zeigt unter "All" alle offenen Aufgaben nach Status', async ({ page }) => {
  await capture(page, 'Bob anrufen @telefon');
  await capture(page, 'Segeln lernen @hafen');
  await page.getByRole('link', { name: 'Segeln lernen' }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('someday');
  await page.getByRole('button', { name: 'Schließen' }).click();

  // "Next" zeigt nur, was jetzt dran ist.
  await expect(page.getByRole('link', { name: 'Segeln lernen' })).toBeHidden();

  await go(page, 'All');
  await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Nächste Aktion' }).getByRole('link', { name: 'Bob anrufen' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Irgendwann' }).getByRole('link', { name: 'Segeln lernen' })).toBeVisible();

  // Die Sortierung von "All" verstellt nicht die von "Next".
  await page.getByRole('combobox', { name: 'Sortieren' }).selectOption('created');
  await go(page, 'Next');
  await expect(page.getByRole('combobox', { name: 'Sortieren' })).toHaveValue('due');

  // Alte Lesezeichen auf "Wartet" landen in "All".
  await page.goto('/waiting');
  await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();
});

test('filtert "All" nach mehreren Status, ohne eine weitere Chipzeile', async ({ page }) => {
  await capture(page, 'Bob anrufen @telefon');
  await capture(page, 'Segeln lernen @hafen');
  await page.getByRole('link', { name: 'Segeln lernen' }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('someday');
  await page.getByRole('button', { name: 'Schließen' }).click();

  await go(page, 'All');
  await page.getByRole('button', { name: 'Status', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Irgendwann' }).click();
  await expect(page.getByRole('checkbox', { name: 'Irgendwann' })).toBeChecked();
  await expect(page.getByRole('link', { name: 'Segeln lernen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bob anrufen' })).toBeHidden();

  // Mehrfachauswahl: ein zweiter Status kommt hinzu.
  await page.getByRole('checkbox', { name: 'Nächste Aktion' }).click();
  await expect(page.getByRole('link', { name: 'Bob anrufen' })).toBeVisible();

  // Escape schließt das Auswahlfeld, der Chip nennt die Auswahl.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: 'Irgendwann' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Status: Nächste Aktion, Irgendwann' })).toBeVisible();

  // Die Auswahl übersteht einen Neustart.
  await page.reload();
  await page.getByRole('button', { name: /^Status:/ }).click();
  await page.getByRole('button', { name: 'Alle Status zeigen' }).click();
  await expect(page.getByRole('button', { name: 'Status', exact: true })).toBeVisible();
});

test('bedient die Liste mit der Tastatur', async ({ page }) => {
  await capture(page, 'Erste Sache @büro');
  await capture(page, 'Zweite Sache @büro');
  await capture(page, 'Dritte Sache @büro');

  // j/k bewegen den echten DOM-Fokus, nicht eine zweite Auswahl daneben.
  await page.getByRole('link', { name: 'Erste Sache' }).focus();
  await page.keyboard.press('j');
  await expect(page.getByRole('link', { name: 'Zweite Sache' })).toBeFocused();
  await page.keyboard.press('k');
  await expect(page.getByRole('link', { name: 'Erste Sache' })).toBeFocused();

  // x erledigt die fokussierte Aufgabe und setzt den Fokus auf die nachrückende.
  await page.keyboard.press('x');
  await expect(page.getByRole('link', { name: 'Erste Sache' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Zweite Sache' })).toBeFocused();
});

test('exportiert und importiert eine Sicherung', async ({ page }) => {
  await capture(page, 'Vor dem Export @büro');

  await page.getByRole('link', { name: 'Einstellungen' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als JSON exportieren' }).click();
  const file = await (await download).path();

  // Alles löschen und aus der Sicherung wiederherstellen.
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('tidypepple');
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByRole('link', { name: 'Vor dem Export' })).toBeHidden();

  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText(/eingespielt/)).toBeVisible();

  await go(page, 'Next');
  await expect(page.getByRole('link', { name: 'Vor dem Export' })).toBeVisible();
});

test('stellt die Schrift klein, normal oder groß und merkt sich das', async ({ page }) => {
  const rootSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await capture(page, 'Ein ziemlich langer Aufgabentitel, der umbrechen muss @büro !morgen');
  expect(await rootSize()).toBe('16px');

  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Sehr groß' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Klein' }).click();
  await expect(page.getByRole('button', { name: 'Klein' })).toHaveAttribute('aria-pressed', 'true');
  expect(await rootSize()).toBe('14px');

  await page.reload();
  expect(await rootSize()).toBe('14px');

  // Wer früher "Sehr groß" gewählt hatte, landet bei "Groß".
  await page.evaluate(() => localStorage.setItem('tidypepple.textSize', 'larger'));
  await page.reload();
  expect(await rootSize()).toBe('18px');
  await expect(page.getByRole('button', { name: 'Groß' })).toHaveAttribute('aria-pressed', 'true');

  // Auch in der größten Stufe passt alles in die Breite – auf dem Handy wie am Desktop.
  await go(page, 'Next');
  await expect(page.getByRole('link', { name: /Ein ziemlich langer/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Normal' }).click();
  expect(await rootSize()).toBe('16px');
});

test('weist einmal darauf hin, dass die Daten nur im Browser liegen', async ({ page }) => {
  const notice = page.getByRole('complementary', { name: 'Deine Daten liegen nur in diesem Browser' });
  // Erster Start ohne eigene Aufgabe: nichts zu verlieren, also kein Hinweis.
  await expect(notice).toBeHidden();

  await capture(page, 'Rechnung bezahlen @büro');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Verstanden' }).click();
  await expect(notice).toBeHidden();

  // Gelesen ist gelesen – auch nach Neustart und weiteren Aufgaben.
  await page.reload();
  await capture(page, 'Ablage sortieren @büro');
  await expect(page.getByRole('link', { name: 'Ablage sortieren' })).toBeVisible();
  await expect(notice).toBeHidden();
});

test('zeigt bei einer unbekannten Adresse eine eigene Seite statt der von React Router', async ({ page }) => {
  await page.goto('/gibt-es-nicht');
  await expect(page.getByRole('heading', { name: 'Diese Seite gibt es nicht' })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
  await page.getByRole('link', { name: 'Zur Liste' }).click();
  await expect(page.getByRole('heading', { name: 'Next' })).toBeVisible();
});

/**
 * Zieht per Tastatur, wie ein Screenreader-Nutzer: Griff fokussieren, Leertaste, Pfeile,
 * Leertaste. dnd-kit misst nach jedem Schritt neu – ohne kurze Pause verschluckt es Tasten.
 */
const dragWithKeys = async (page: Page, handle: string, steps: number): Promise<void> => {
  await page.getByRole('button', { name: handle }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: handle })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(250);
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await page.keyboard.press(steps < 0 ? 'ArrowUp' : 'ArrowDown');
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Space');
};

test('sortiert Aufgaben und Projekte von Hand per Griff, auch mit der Tastatur', async ({ page }) => {
  for (const text of ['Alpha !heute', 'Bravo !heute', 'Charlie !heute']) await capture(page, text);
  const rows = page.locator('main ul [data-task-row]');

  // Ohne manuelle Sortierung gibt es keinen Griff.
  await expect(page.getByRole('button', { name: 'Alpha verschieben' })).toHaveCount(0);
  await page.locator('#sort-key').selectOption('manual');
  await expect(rows).toHaveText(['Alpha', 'Bravo', 'Charlie']);

  await dragWithKeys(page, 'Charlie verschieben', -2);
  await expect(rows).toHaveText(['Charlie', 'Alpha', 'Bravo']);
  await page.reload();
  await expect(rows).toHaveText(['Charlie', 'Alpha', 'Bravo']);

  await capture(page, 'Streichen +Renovierung');
  await capture(page, 'Flüge buchen +Urlaub');
  await go(page, 'Projekte');
  const projects = page.locator('main ul li .text-heading-16');
  await expect(projects).toHaveText(['Renovierung', 'Urlaub']);
  await dragWithKeys(page, 'Urlaub verschieben', -1);
  await expect(projects).toHaveText(['Urlaub', 'Renovierung']);
});

test('zeigt im Detail, wann eine Aufgabe erfasst wurde und wie alt sie ist', async ({ page }) => {
  await capture(page, 'Alte Sache !heute');
  // Die Liste bleibt ruhig: kein Erstellungsdatum auf der Karte.
  await expect(page.getByRole('listitem').filter({ hasText: 'Alte Sache' })).not.toContainText('Erstellt');
  await page.getByRole('link', { name: 'Alte Sache' }).click();
  await expect(page.getByText(/^Erstellt am .+ \(heute\)$/)).toBeVisible();
});
