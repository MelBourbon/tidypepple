import { describe, expect, it } from 'vitest';
import { activeToken, applySuggestion, isKnown, isTypeable, searchText, suggest, tokenFor } from '@/domain/captureSuggest';

describe('activeToken', () => {
  it('erkennt das Token mit Marker, an dessen Ende der Cursor steht', () => {
    expect(activeToken('Bob anrufen @tel', 16)).toEqual({ marker: '@', query: 'tel', start: 12, end: 16 });
    expect(activeToken('Kisten +Um', 10)).toMatchObject({ marker: '+', query: 'Um' });
    expect(activeToken('#st', 3)).toMatchObject({ marker: '#', query: 'st', start: 0 });
  });

  it('liefert schon für den Marker allein ein Token mit leerer Suche', () => {
    expect(activeToken('Bob @', 5)).toMatchObject({ marker: '@', query: '' });
  });

  it('greift nicht mitten im Token, nicht ohne Marker und nicht bei einer E-Mail-Adresse', () => {
    expect(activeToken('Bob @telefon', 7)).toBeNull();
    expect(activeToken('Bob anrufen', 11)).toBeNull();
    expect(activeToken('bob@example', 11)).toBeNull();
    expect(activeToken('', 0)).toBeNull();
  });

  it('greift, wenn hinter dem Cursor schon das nächste Wort folgt', () => {
    expect(activeToken('Bob @te anrufen', 7)).toMatchObject({ query: 'te', end: 7 });
  });
});

describe('suggest', () => {
  const contexts = ['büro', 'telefon', 'zuhause', 'Besorgungen'];

  it('findet Namen unabhängig von Groß-/Kleinschreibung und Umlauten', () => {
    expect(suggest(contexts, 'bü')).toEqual(['büro']);
    expect(suggest(contexts, 'bue')).toEqual(['büro']);
    expect(suggest(contexts, 'BU')).toEqual(['büro']);
    expect(suggest(contexts, 'be')).toEqual(['Besorgungen']);
  });

  it('stellt Treffer am Anfang vor Treffer im Wort', () => {
    expect(suggest(['Hausaufgaben', 'Aufräumen'], 'auf')).toEqual(['Aufräumen', 'Hausaufgaben']);
  });

  it('zeigt beim Marker allein alle, höchstens bis zum Limit', () => {
    expect(suggest(contexts, '')).toEqual(contexts);
    expect(suggest(contexts, '', 2)).toEqual(['büro', 'telefon']);
  });

  it('zeigt gleichnamige Einträge nur einmal', () => {
    expect(suggest(['Umzug', 'umzug', 'Urlaub'], 'u')).toEqual(['Umzug', 'Urlaub']);
  });

  it('schlägt nichts vor, was schon genau dasteht', () => {
    expect(suggest(contexts, 'Büro')).toEqual([]);
  });
});

describe('applySuggestion', () => {
  it('ersetzt das Token und setzt ein Leerzeichen für das nächste Wort', () => {
    const value = 'Bob anrufen @tel';
    expect(applySuggestion(value, activeToken(value, 16)!, 'telefon')).toEqual({
      value: 'Bob anrufen @telefon ',
      caret: 21,
    });
  });

  it('lässt den Text dahinter stehen und verdoppelt kein Leerzeichen', () => {
    const value = 'Bob @te anrufen';
    expect(applySuggestion(value, activeToken(value, 7)!, 'telefon')).toEqual({
      value: 'Bob @telefon anrufen',
      caret: 13,
    });
  });

  it('schreibt Projekte mit Leerzeichen so, wie der Parser sie liest', () => {
    const value = 'Kisten +Um';
    expect(applySuggestion(value, activeToken(value, 10)!, 'Umzug nach Köln').value).toBe('Kisten +Umzug_nach_Köln ');
    expect(tokenFor('@', 'büro')).toBe('@büro');
  });
});

describe('isTypeable und isKnown', () => {
  it('schlägt Kontexte mit Leerzeichen nicht vor, Projekte schon', () => {
    expect(isTypeable('@', 'zu Hause')).toBe(false);
    expect(isTypeable('+', 'Umzug nach Köln')).toBe(true);
  });

  it('schlägt keine Projekte vor, die als Token zu einem anderen Namen würden', () => {
    expect(isTypeable('+', 'foo_bar')).toBe(false);
    expect(isTypeable('+', '2027')).toBe(false);
  });

  it('sucht bei Projekten mit Leerzeichen statt Unterstrich', () => {
    const token = activeToken('Kisten +Umzug_n', 15)!;
    expect(searchText(token)).toBe('Umzug n');
    expect(suggest(['Umzug nach Köln'], searchText(token))).toEqual(['Umzug nach Köln']);
    expect(suggest(['Umzug nach Köln'], searchText(activeToken('+Umzug_nach_Köln', 16)!))).toEqual([]);
  });

  it('kennt Namen ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(isKnown(['Büro'], 'büro')).toBe(true);
    expect(isKnown(['Büro'], 'buero')).toBe(false);
  });
});
