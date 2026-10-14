import { describe, expect, it } from 'vitest';
import { taskFromShare, titleFromText } from '@/domain/share';

describe('taskFromShare', () => {
  it('nimmt den Textanfang als Titel und den ganzen Text als Notiz', () => {
    expect(taskFromShare({ text: 'Milch kaufen\nund Brot nicht vergessen' })).toEqual({
      title: 'Milch kaufen',
      notes: 'Milch kaufen\nund Brot nicht vergessen',
    });
  });

  it('bevorzugt einen mitgeschickten Titel (Chrome: Seitentitel + Adresse)', () => {
    expect(taskFromShare({ title: 'Ein Artikel', text: 'https://example.com/a' })).toEqual({
      title: 'Ein Artikel',
      notes: 'https://example.com/a',
    });
  });

  it('hängt die URL an, wenn sie nicht schon im Text steht', () => {
    expect(taskFromShare({ text: 'Lesen!', url: 'https://example.com' })?.notes).toBe('Lesen!\n\nhttps://example.com');
    expect(taskFromShare({ text: 'Lesen: https://example.com', url: 'https://example.com' })?.notes).toBe(
      'Lesen: https://example.com',
    );
  });

  it('nimmt ohne Text den ersten Dateinamen als Titel', () => {
    expect(taskFromShare({ files: ['', 'Rechnung.pdf', 'b.jpg'] })).toEqual({ title: 'Rechnung.pdf', notes: '' });
    expect(taskFromShare({ text: 'Zur Steuer', files: ['Rechnung.pdf'] })?.title).toBe('Zur Steuer');
    expect(taskFromShare({ files: [] })).toBeNull();
  });

  it('ignoriert leere Freigaben', () => {
    expect(taskFromShare({})).toBeNull();
    expect(taskFromShare({ title: '  ', text: '\n' })).toBeNull();
  });
});

describe('titleFromText', () => {
  it('kürzt lange Zeilen an einer Wortgrenze', () => {
    const title = titleFromText('Das ist ein ziemlich langer geteilter Text, der nicht vollständig in den Titel passt');
    expect(title).toBe('Das ist ein ziemlich langer geteilter Text, der nicht…');
  });

  it('kürzt ohne Wortgrenze hart', () => {
    expect(titleFromText('x'.repeat(80))).toBe(`${'x'.repeat(60)}…`);
  });

  it('überspringt führende Leerzeilen', () => {
    expect(titleFromText('\n\n  Hallo\nWelt')).toBe('Hallo');
  });
});
