import { describe, expect, it } from 'vitest';
import { parseDateToken, parseQuickAdd } from '@/domain/quickAdd';

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

  it('behält unverständliche Datumsangaben im Titel', () => {
    const r = parseQuickAdd('Sache erledigen !irgendwann', REF);
    expect(r.title).toBe('Sache erledigen !irgendwann');
    expect(r.dueDate).toBeNull();
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
