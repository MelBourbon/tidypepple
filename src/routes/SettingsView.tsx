import { useState } from 'react';
import { ApiAccessSettings } from '@/components/ApiAccessSettings';
import { OrderButtons } from '@/components/OrderButtons';
import { PageHeader } from '@/components/PageHeader';
import { SyncIndicator } from '@/components/SyncIndicator';
import { SyncSettings } from '@/components/SyncSettings';
import { db } from '@/data/db';
import { useContexts } from '@/data/hooks';
import { createContext, deleteContext, importRecords, moveContext, updateContext } from '@/data/repo';
import { useToast } from '@/components/Toast';
import { useSync } from '@/sync/SyncProvider';
import { androidBridge } from '@/platform/android';
import { readTextSize, TEXT_SIZES, writeTextSize, type TextSize } from '@/ui/textSize';
import {
  browserLocale,
  LOCALE_NAMES,
  LOCALES,
  readLocalePreference,
  t,
  writeLocalePreference,
  type LocalePreference,
} from '@/i18n';
import { FEEDBACK_URL } from '@/feedback';

export function SettingsView(): React.ReactNode {
  const contexts = useContexts();
  const [name, setName] = useState('');
  const toast = useToast();
  const sync = useSync();
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);

  /** Export als Klartext-JSON – die Verschlüsselung schützt den Server, nicht den Nutzer vor sich selbst. */
  const exportJson = async (): Promise<void> => {
    const data = {
      exportedAt: new Date().toISOString(),
      tasks: await db.tasks.toArray(),
      contexts: await db.contexts.toArray(),
    };
    const json = JSON.stringify(data, null, 2);
    const name = `tidypepple-${new Date().toISOString().slice(0, 10)}.json`;
    // Die WebView der Android-App kann keine blob:-Downloads; dort speichert die Hülle.
    const bridge = androidBridge();
    if (bridge !== null) {
      await bridge.saveFile({ name, mimeType: 'application/json', content: json }).catch(() => {
        toast({ message: t.settings.exportFailed });
      });
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File): Promise<void> => {
    try {
      const payload = JSON.parse(await file.text()) as Parameters<typeof importRecords>[0];
      toast({ message: t.settings.imported(await importRecords(payload)) });
    } catch {
      toast({ message: t.settings.importFailed });
    }
  };

  return (
    <>
      <PageHeader title={t.settings.title} showSettings={false} />

      <section className="px-4 py-3">
        <h2 className="mb-2 text-overline">{t.settings.contexts}</h2>
        <p className="mb-2 text-xs text-muted">{t.settings.contextsHint}</p>
        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          {contexts.map((c, index) => (
            <li key={c.id} className="flex items-center gap-2 border-b border-line pl-3 last:border-b-0">
              <span aria-hidden="true" className="text-muted">@</span>
              <input
                value={c.name}
                onChange={(e) => void updateContext(c.id, { name: e.target.value })}
                aria-label={t.settings.contextName(c.name)}
                className="min-h-11 flex-1 bg-transparent text-sm outline-none"
              />
              <OrderButtons
                items={contexts}
                index={index}
                label={`@${c.name}`}
                onMove={(id, target) => void moveContext(id, target)}
              />
              <button
                type="button"
                onClick={() => void deleteContext(c.id)}
                aria-label={`${t.task.delete}: @${c.name}`}
                className="flex size-11 items-center justify-center text-muted hover:text-danger"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
          <li className="px-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() === '') return;
                void createContext(name.trim());
                setName('');
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.settings.newContext}
                aria-label={t.settings.newContext}
                className="min-h-11 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
              />
            </form>
          </li>
        </ul>
      </section>

      <section className="px-4 py-3">
        <h2 className="mb-2 text-overline">{t.settings.sync}</h2>
        <div className="mb-2">
          <SyncIndicator />
        </div>
        <SyncSettings />
      </section>

      {sync.apiTokens !== null && (
        <section className="px-4 py-3">
          <h2 className="mb-2 text-overline">{t.api.title}</h2>
          <ApiAccessSettings access={sync.apiTokens} />
        </section>
      )}

      <section className="px-4 py-3">
        <h2 id="settings-text-size" className="mb-2 text-overline">
          {t.settings.textSize}
        </h2>
        {/* Wirkt sofort, ohne Neuladen – man soll sehen, was man wählt. Das „A“ wächst mit. */}
        <div role="group" aria-labelledby="settings-text-size" className="flex flex-wrap gap-2">
          {TEXT_SIZES.map((size, i) => (
            <button
              key={size}
              type="button"
              aria-pressed={textSize === size}
              onClick={() => {
                writeTextSize(size);
                setTextSize(size);
              }}
              className={[
                'flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm transition-colors',
                textSize === size ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface hover:bg-raised',
              ].join(' ')}
            >
              <span aria-hidden="true" className={['font-semibold', ['text-sm', 'text-base', 'text-lg'][i]].join(' ')}>
                A
              </span>
              {t.settings.textSizes[size]}
            </button>
          ))}
        </div>
      </section>

      <section className="px-4 py-3">
        <h2 className="mb-2 text-overline">
          <label htmlFor="settings-language">{t.settings.language}</label>
        </h2>
        {/* Neu laden statt umschalten: die Texte stehen beim Start fest (siehe i18n/index.ts). */}
        <select
          id="settings-language"
          defaultValue={readLocalePreference()}
          onChange={(e) => {
            writeLocalePreference(e.target.value as LocalePreference);
            location.reload();
          }}
          className="min-h-11 rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised"
        >
          <option value="auto">{t.settings.languageAuto(LOCALE_NAMES[browserLocale])}</option>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </section>

      <section className="px-4 py-3">
        <h2 className="mb-2 text-overline">{t.settings.data}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportJson()}
            className="min-h-11 rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised"
          >
            {t.settings.export}
          </button>
          {/* Eigenes Label statt eines gestylten File-Inputs: das Dateifeld bleibt ein
              echtes Formularelement und damit tastaturbedienbar. */}
          <label className="flex min-h-11 cursor-pointer items-center rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised">
            {t.settings.import}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void importJson(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">{t.settings.importHint}</p>
      </section>

      <section className="px-4 py-3">
        <h2 className="mb-2 text-overline">{t.settings.feedback}</h2>
        {/* GitHub-Issues statt Mail: Fehler und Ideen sind für alle sichtbar, und andere
            können sie ergänzen. Neuer Tab, damit die App offen bleibt. */}
        <a
          href={FEEDBACK_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised"
        >
          {t.settings.feedbackButton}
        </a>
        <p className="mt-2 text-xs text-muted">{t.settings.feedbackHint}</p>
      </section>
    </>
  );
}
