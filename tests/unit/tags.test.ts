import { describe, expect, it } from 'vitest';
import { allTags, cleanTagName, withoutTag, withTag } from '@/domain/tags';
import { normalizeTask } from '@/domain/types';
import { task } from './factory';

describe('Tags', () => {
  it('bereinigt Eingaben und verwirft solche ohne Buchstaben', () => {
    expect(cleanTagName('  #Steuer ')).toBe('Steuer');
    expect(cleanTagName('zwei Worte')).toBe('zwei_Worte');
    expect(cleanTagName('#123')).toBeNull();
    expect(cleanTagName('#')).toBeNull();
  });

  it('fügt ohne Dubletten hinzu und entfernt unabhängig von der Schreibweise', () => {
    expect(withTag(['Steuer'], '#steuer')).toEqual(['Steuer']);
    expect(withTag(['Steuer'], 'privat')).toEqual(['Steuer', 'privat']);
    expect(withoutTag(['Steuer', 'privat'], 'STEUER')).toEqual(['privat']);
  });

  it('sammelt die Tags lebender Aufgaben alphabetisch, erste Schreibweise gewinnt', () => {
    const tasks = [
      task({ tags: ['steuer', 'Privat'] }),
      task({ tags: ['Steuer', 'arbeit'] }),
      task({ tags: ['gelöscht'], deletedAt: 1 }),
    ];
    expect(allTags(tasks)).toEqual(['arbeit', 'Privat', 'steuer']);
  });

  it('ergänzt fehlende Tags älterer Geräte und Sicherungen', () => {
    expect(normalizeTask({ id: 'a', title: 'x' })?.tags).toEqual([]);
    expect(normalizeTask({ id: 'a', title: 'x', tags: ['ok', 3, '', null] })?.tags).toEqual(['ok']);
  });
});
