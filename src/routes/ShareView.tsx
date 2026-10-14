import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { prepareAttachment } from '@/components/prepareAttachment';
import { useToast } from '@/components/Toast';
import { addAttachment } from '@/data/attachments';
import { createTask } from '@/data/repo';
import { taskFromShare, type SharedData } from '@/domain/share';
import { t } from '@/i18n';
import { androidBridge, type AndroidBridge } from '@/platform/android';

/**
 * Ziel des Manifest-Eintrags `share_target`: Android öffnet
 * `/share?title=…&text=…&url=…`. Daraus wird eine Inbox-Aufgabe – geklärt wird wie bei
 * jeder Erfassung später.
 *
 * Die Android-App hängt bei geteilten Fotos und PDFs `files=<token>` an; die Dateien holt
 * sie dann über die Bridge und sie werden Anhänge der Aufgabe.
 *
 * Danach ersetzt die Inbox diese Adresse in der History, damit Zurück oder Neuladen die
 * Aufgabe nicht ein zweites Mal anlegt.
 */
export function ShareView(): React.ReactNode {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  // StrictMode führt Effekte in der Entwicklung doppelt aus; die Ref überlebt das.
  const handled = useRef(false);

  const data: SharedData = { title: params.get('title'), text: params.get('text'), url: params.get('url') };
  const token = params.get('files');
  const bridge = androidBridge();
  const withFiles = token !== null && bridge !== null;
  const shared = taskFromShare(data);

  useEffect(() => {
    if (handled.current || (!withFiles && shared === null)) return;
    handled.current = true;
    const saved = withFiles
      ? saveWithFiles(bridge, token, data)
      : createTask({ ...shared!, status: 'inbox' }).then(() => t.share.received);
    void saved
      .catch(() => t.share.filesFailed)
      .then((message) => {
        if (message !== null) toast({ message });
        void navigate('/inbox', { replace: true });
      });
  });

  return !withFiles && shared === null ? <Navigate to="/inbox" replace /> : null;
}

/**
 * Legt die Aufgabe an und hängt die Dateien an. Liefert die Meldung für den Toast: den
 * ersten Grund, aus dem eine Datei fehlt, sonst „gespeichert“; `null`, wenn nichts kam.
 */
async function saveWithFiles(bridge: AndroidBridge, token: string, data: SharedData): Promise<string | null> {
  try {
    const files = (await bridge.sharedFiles(token)) ?? [];
    const shared = taskFromShare({ ...data, files: files.map((file) => file.name) });
    if (shared === null) return null;
    const task = await createTask({ ...shared, status: 'inbox' });

    let problem: string | null = null;
    for (const [index, file] of files.entries()) {
      let next: string | null;
      if (file.tooLarge) {
        next = t.attachments.problem.size(file.name);
      } else {
        try {
          const content = await bridge.sharedFile(token, index);
          const reason = await addAttachment(
            task.id,
            await prepareAttachment(new File([content], file.name, { type: file.mimeType })),
          );
          next = reason === null ? null : t.attachments.problem[reason](file.name);
        } catch {
          next = t.share.filesFailed;
        }
      }
      problem ??= next;
    }
    return problem ?? t.share.received;
  } finally {
    void bridge.sharedDone().catch(() => undefined);
  }
}
