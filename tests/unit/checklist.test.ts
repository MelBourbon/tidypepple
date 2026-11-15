import { describe, expect, it } from 'vitest';
import { appendItem, checklistProgress, hasChecklist, parseNotes, toggleItem } from '@/domain/checklist';
import { MAX_NOTES_LENGTH } from '@/domain/types';

describe('Checklisten in den Notizen', () => {
  it('trennt Punkte und Textblöcke in ihrer Reihenfolge', () => {
    const notes = 'Für Samstag:\n- [ ] Milch\n* [x] Brot\n  - [X] Butter\n\nNicht vergessen\n- [ ]';
    expect(parseNotes(notes)).toEqual([
      { kind: 'text', text: 'Für Samstag:' },
      { kind: 'item', line: 1, done: false, text: 'Milch' },
      { kind: 'item', line: 2, done: true, text: 'Brot' },
      { kind: 'item', line: 3, done: true, text: 'Butter' },
      { kind: 'text', text: '\nNicht vergessen' },
      { kind: 'item', line: 6, done: false, text: '' },
    ]);
  });

  it('erkennt nur echte Aufgabenzeilen', () => {
    expect(hasChecklist('- Milch\n[ ] Brot\n- [ ]Käse\n- [y] Wurst')).toBe(false);
    expect(checklistProgress('Nur Text')).toBeNull();
    expect(checklistProgress('')).toBeNull();
    expect(checklistProgress('- [x] a\r\n- [ ] b\r\n- [x] c')).toEqual({ done: 2, total: 3 });
  });

  it('kippt genau eine Zeile und lässt alles andere unberührt', () => {
    const notes = 'Kopf\r\n  - [ ] Milch\r\n- [x] Brot\r\n';
    expect(toggleItem(notes, 1)).toBe('Kopf\r\n  - [x] Milch\r\n- [x] Brot\r\n');
    expect(toggleItem(notes, 2)).toBe('Kopf\r\n  - [ ] Milch\r\n- [ ] Brot\r\n');
    expect(toggleItem(notes, 0)).toBe(notes);
    expect(toggleItem(notes, 9)).toBe(notes);
    expect(toggleItem('- [X] a', 0)).toBe('- [ ] a');
  });

  it('hängt offene Punkte an', () => {
    expect(appendItem('', 'Milch')).toBe('- [ ] Milch');
    expect(appendItem('Einkauf', '  Brot  ')).toBe('Einkauf\n- [ ] Brot');
    expect(appendItem('- [ ] Milch\n', 'Brot')).toBe('- [ ] Milch\n- [ ] Brot');
    expect(appendItem('Einkauf', '   ')).toBe('Einkauf');
    expect(appendItem('Einkauf', 'zwei\nZeilen')).toBe('Einkauf\n- [ ] zwei Zeilen');
  });

  it('lässt volle Notizen nicht über die Höchstlänge wachsen', () => {
    const full = 'x'.repeat(MAX_NOTES_LENGTH - 3);
    expect(appendItem(full, 'Milch')).toBe(full);
  });
});
