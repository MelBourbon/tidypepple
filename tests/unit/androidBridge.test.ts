import { describe, expect, it } from 'vitest';
import { androidBridge, createBridge, toBase64, type NativeBridge } from '@/platform/android';

/** Hülle zum Testen: antwortet auf jede Nachricht mit dem, was `respond` liefert. */
function fakeNative(respond: (request: Record<string, unknown>) => Record<string, unknown>): {
  native: NativeBridge;
  sent: Record<string, unknown>[];
} {
  const sent: Record<string, unknown>[] = [];
  let listener: ((event: { data: unknown }) => void) | null = null;
  const native: NativeBridge = {
    postMessage: (data) => {
      const request = JSON.parse(data) as Record<string, unknown>;
      sent.push(request);
      // Wie die echte Hülle: Antwort asynchron und als String.
      queueMicrotask(() => listener?.({ data: JSON.stringify({ id: request['id'], ...respond(request) }) }));
    },
    addEventListener: (_type, next) => {
      listener = next;
    },
  };
  return { native, sent };
}

describe('createBridge', () => {
  it('holt geteilte Dateien einzeln und meldet eine abgeholte Freigabe als null', async () => {
    let answer: Record<string, unknown> = {
      ok: true,
      result: { files: [{ name: 'a.pdf', mimeType: 'application/pdf', size: 4, tooLarge: false }] },
    };
    const { native, sent } = fakeNative(() => answer);
    const bridge = createBridge(native);

    await expect(bridge.sharedFiles('tok')).resolves.toEqual([
      { name: 'a.pdf', mimeType: 'application/pdf', size: 4, tooLarge: false },
    ]);
    expect(sent[0]).toMatchObject({ type: 'share.list', token: 'tok' });

    answer = { ok: true, result: { content: 'AAH+/w==' } };
    const blob = await bridge.sharedFile('tok', 0);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 254, 255]);
    expect(sent[1]).toMatchObject({ type: 'share.file', token: 'tok', index: 0 });

    answer = { ok: false, error: 'not-found' };
    await expect(bridge.sharedFiles('tok')).resolves.toBeNull();
    await expect(bridge.sharedFile('tok', 0)).rejects.toThrow('not-found');
  });

  it('fragt die App-Version ab', async () => {
    const { native, sent } = fakeNative(() => ({ ok: true, result: { versionCode: 3, versionName: '2.0.0', bridge: 1 } }));
    await expect(createBridge(native).info()).resolves.toEqual({ versionCode: 3, versionName: '2.0.0', bridge: 1 });
    expect(sent[0]).toMatchObject({ type: 'app.info' });
  });

  it('speichert Text als utf8 und meldet einen Abbruch ohne Fehler', async () => {
    let answer: Record<string, unknown> = { ok: true, result: { saved: true } };
    const { native, sent } = fakeNative(() => answer);
    const bridge = createBridge(native);
    const file = { name: 'a.json', mimeType: 'application/json', content: '{"ä":1}' };

    await expect(bridge.saveFile(file)).resolves.toBe('saved');
    expect(sent[0]).toMatchObject({ type: 'file.save', name: 'a.json', content: '{"ä":1}', encoding: 'utf8' });

    answer = { ok: false, error: 'cancelled' };
    await expect(bridge.saveFile(file)).resolves.toBe('cancelled');

    answer = { ok: false, error: 'failed' };
    await expect(bridge.saveFile(file)).rejects.toThrow('failed');
  });

  it('schickt Binärdateien als Base64', async () => {
    const { native, sent } = fakeNative(() => ({ ok: true, result: {} }));
    const blob = new Blob([new Uint8Array([0, 1, 254, 255])], { type: 'application/pdf' });
    await createBridge(native).openFile({ name: 'x.pdf', mimeType: 'application/pdf', content: blob });
    expect(sent[0]).toMatchObject({ type: 'file.open', encoding: 'base64', content: 'AAH+/w==' });
  });

  it('schickt Erinnerungen als ganze Liste und meldet die Erlaubnis', async () => {
    let answer: Record<string, unknown> = { ok: true, result: {} };
    const { native, sent } = fakeNative(() => answer);
    const bridge = createBridge(native);
    const reminders = [{ id: 't1', at: '2026-10-07T08:00', title: 'Bob anrufen' }];

    await bridge.syncReminders(reminders);
    expect(sent[0]).toMatchObject({ type: 'reminder.sync', reminders });

    answer = { ok: true, result: { granted: true } };
    await expect(bridge.notificationPermission()).resolves.toBe('granted');
    answer = { ok: true, result: { granted: false } };
    await expect(bridge.notificationPermission()).resolves.toBe('denied');
    expect(sent[1]).toMatchObject({ type: 'notification.permission' });
  });

  it('ordnet Antworten über die ID zu und ignoriert fremde Nachrichten', async () => {
    const { native } = fakeNative((request) =>
      request['type'] === 'open.external' ? { ok: false, error: 'invalid-url' } : { ok: true, result: { bridge: 1 } },
    );
    const bridge = createBridge(native);
    const [info, external] = await Promise.allSettled([bridge.info(), bridge.openExternal('ftp://x')]);
    expect(info).toMatchObject({ status: 'fulfilled', value: { bridge: 1 } });
    expect(external).toMatchObject({ status: 'rejected' });
  });
});

describe('toBase64', () => {
  it('kommt mit großen Dateien zurecht', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const encoded = await toBase64(new Blob([bytes]));
    expect(Buffer.from(encoded, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('androidBridge', () => {
  it('ist ohne Hülle null, damit alles wie im Browser läuft', () => {
    expect(androidBridge()).toBeNull();
  });
});
