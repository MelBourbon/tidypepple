import { describe, expect, it } from 'vitest';
import { captureDestination, parseDateToken, parseQuickAdd } from '@/domain/quickAdd';

const REF = '2026-09-27'; // ein Sonntag

describe('parseDateToken', () => {
  it('versteht relative Angaben', () => {
    expect(parseDateToken('heute', REF)).toBe('2026-09-27');
    expect(parseDateToken('morgen', REF)).toBe('2026-09-28');
    expect(parseDateToken('übermorgen', REF)).toBe('2026-09-29');
    expect(parseDateToken('+10', REF)).toBe('2026-10-07');
  });

  it('springt bei Wochentagen immer in die Zukunft', () => {
    expect(parseDateToken('mo', REF)).toBe('2026-09-28');
    // Heute ist Sonntag: "so" meint den nächsten, nicht den heutigen.
    expect(parseDateToken('so', REF)).toBe('2026-10-04');
  });

  it('versteht ISO- und deutsche Datumsformate', () => {
    expect(parseDateToken('2026-10-01', REF)).toBe('2026-10-01');
    expect(parseDateToken('1.10.', REF)).toBe('2026-10-01');
    expect(parseDateToken('24.12.2027', REF)).toBe('2027-12-24');
  });

  it('schiebt ein Datum ohne Jahr, das schon vorbei ist, ins nächste Jahr', () => {
    expect(parseDateToken('1.1.', REF)).toBe('2027-01-01');
  });

  it('versteht auch englische Angaben', () => {
    expect(parseDateToken('today', REF)).toBe('2026-09-27');
    expect(parseDateToken('Tomorrow', REF)).toBe('2026-09-28');
    expect(parseDateToken('nextweek', REF)).toBe('2026-10-04');
    expect(parseDateToken('mon', REF)).toBe('2026-09-28');
    expect(parseDateToken('friday', REF)).toBe('2026-10-02');
    expect(parseDateToken('sun', REF)).toBe('2026-10-04');
  });

  it('versteht ein deutsches Datum auch ohne Schlusspunkt', () => {
    expect(parseDateToken('1.10', REF)).toBe('2026-10-01');
    expect(parseDateToken('24.12', REF)).toBe('2026-12-24');
    expect(parseDateToken('1.9', REF)).toBe('2027-09-01');
  });

  it('lässt unmögliche Daten nicht in den Folgemonat überlaufen', () => {
    expect(parseDateToken('31.2.', REF)).toBeNull();
    expect(parseDateToken('1.13', REF)).toBeNull();
    expect(parseDateToken('2026-02-30', REF)).toBeNull();
    expect(parseDateToken('29.2.2028', REF)).toBe('2028-02-29');
  });

  it('findet für den 29.2. ohne Jahr das nächste Schaltjahr', () => {
    expect(parseDateToken('29.2.', '2027-03-01')).toBe('2028-02-29');
    expect(parseDateToken('29.2.', '2028-03-01')).toBe('2032-02-29');
    expect(parseDateToken('29.2.', '2028-02-01')).toBe('2028-02-29');
  });

  it('lehnt alles andere ab', () => {
    expect(parseDateToken('bald', REF)).toBeNull();
    expect(parseDateToken('', REF)).toBeNull();
  });
});

describe('parseQuickAdd', () => {
  it('trennt Titel, Kontexte, Projekt, Tags und Daten', () => {
    const r = parseQuickAdd('Bob anrufen @telefon @büro +Umzug #privat !morgen >mo', REF);
    expect(r.title).toBe('Bob anrufen');
    expect(r.contextNames).toEqual(['telefon', 'büro']);
    expect(r.projectName).toBe('Umzug');
    expect(r.tagNames).toEqual(['privat']);
    expect(r.dueDate).toBe('2026-09-28');
    expect(r.deferDate).toBe('2026-09-28');
  });

  it('lässt eine E-Mail-Adresse im Titel stehen, statt sie als Kontext zu lesen', () => {
    const r = parseQuickAdd('Mail an bob@example.com schreiben', REF);
    expect(r.title).toBe('Mail an bob@example.com schreiben');
    expect(r.contextNames).toEqual([]);
  });

  it('behält unverständliche Datumsangaben im Titel und meldet sie', () => {
    const r = parseQuickAdd('Sache erledigen !irgendwann >bald', REF);
    expect(r.title).toBe('Sache erledigen !irgendwann >bald');
    expect(r.dueDate).toBeNull();
    expect(r.unrecognized).toEqual(['!irgendwann', '>bald']);
  });

  it('hält Satzzeichen nicht für ein verunglücktes Datum', () => {
    expect(parseQuickAdd('Wirklich !? Herd aus !! a >> b', REF).unrecognized).toEqual([]);
    expect(parseQuickAdd('Temperatur >5 Grad !+ prüfen', REF).unrecognized).toEqual([]);
    expect(parseQuickAdd('Termin !32.1.', REF).unrecognized).toEqual(['!32.1.']);
  });

  it('nennt das Ziel der Erfassung', () => {
    expect(captureDestination(parseQuickAdd('Einfach ein Gedanke !!', REF))).toBe('inbox');
    expect(captureDestination(parseQuickAdd('Bob anrufen @telefon', REF))).toBe('next');
    expect(captureDestination(parseQuickAdd('Steuer !fr', REF))).toBe('next');
    expect(captureDestination(parseQuickAdd('Steuer >fr', REF))).toBe('inbox');
    expect(captureDestination(parseQuickAdd('Kisten +Umzug', REF))).toBe('project');
  });

  it('ersetzt Unterstriche im Projektnamen durch Leerzeichen', () => {
    expect(parseQuickAdd('Kiste packen +Umzug_nach_Köln', REF).projectName).toBe('Umzug nach Köln');
  });

  it('liest # als Tag statt als Projekt, mehrere und ohne Dubletten', () => {
    const r = parseQuickAdd('Belege sortieren #Steuer #2026er #steuer', REF);
    expect(r).toMatchObject({ title: 'Belege sortieren', projectName: null });
    expect(r.tagNames).toEqual(['Steuer', '2026er']);
  });

  it('lässt Nummern und Telefonnummern im Titel stehen', () => {
    const r = parseQuickAdd('Ticket #123 an +49 30 1234 melden', REF);
    expect(r.title).toBe('Ticket #123 an +49 30 1234 melden');
    expect(r.tagNames).toEqual([]);
    expect(r.projectName).toBeNull();
  });

  it('funktioniert ganz ohne Syntax', () => {
    const r = parseQuickAdd('Einfach nur ein Gedanke', REF);
    expect(r).toMatchObject({ title: 'Einfach nur ein Gedanke', projectName: null, dueDate: null, highPriority: false });
  });

  it('markiert mit einem alleinstehenden !! als wichtig', () => {
    expect(parseQuickAdd('Steuer abgeben !! !morgen', REF)).toMatchObject({
      title: 'Steuer abgeben',
      highPriority: true,
      dueDate: '2026-09-28',
    });
    // Ausrufezeichen am Wort gehören zum Titel.
    expect(parseQuickAdd('Achtung!! Herd aus', REF)).toMatchObject({ title: 'Achtung!! Herd aus', highPriority: false });
  });
});
