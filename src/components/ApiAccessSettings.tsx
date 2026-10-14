import { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Primary, Row, Secondary } from './SyncSettings';
import type { ApiTokenScope } from '@/crypto/apiToken';
import type { ApiTokenInfo } from '@/sync/apiTokens';
import type { ApiTokenAccess } from '@/sync/SyncProvider';
import { t } from '@/i18n';

/**
 * API-Tokens für den MCP-Server. Erscheint nur mit aktivem Abo und entsperrtem
 * Vault – ohne beides gäbe es weder Berechtigung noch einen Schlüssel zum Verpacken.
 */

/** Liegt neben der App, wenn sie mit `npm run build:mcp` gebaut wurde (siehe docs/mcp.md). */
const EXTENSION_URL = '/downloads/tidypepple.mcpb';

export function ApiAccessSettings({ access }: { access: ApiTokenAccess }): React.ReactNode {
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // `access` entsteht bei jedem Rendern neu; die Liste soll trotzdem nur einmal laden.
  const latest = useRef(access);
  latest.current = access;

  const reload = useCallback(() => {
    latest.current
      .list()
      .then(setTokens)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(reload, [reload]);

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <p className="text-sm">{t.api.intro}</p>
      <p className="mt-1 text-xs text-muted">{t.api.privacy}</p>

      {error !== null && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {created !== null ? (
        <CreatedPanel
          token={created}
          onDone={() => {
            setCreated(null);
            reload();
          }}
        />
      ) : (
        <>
          <TokenList
            tokens={tokens}
            onRevoke={(id) => {
              setError(null);
              access
                .revoke(id)
                .then(reload)
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
            }}
          />
          <CreateForm
            onCreate={async (passphrase, name, scope) => {
              setError(null);
              try {
                setCreated(await access.create(passphrase, name, scope));
                return true;
              } catch (cause) {
                // AES-GCM meldet eine falsche Passphrase als OperationError – ohne Text.
                const wrongPassphrase = cause instanceof DOMException && cause.name === 'OperationError';
                setError(wrongPassphrase ? t.api.wrongPassphrase : cause instanceof Error ? cause.message : String(cause));
                return false;
              }
            }}
          />
        </>
      )}
    </div>
  );
}

function TokenList({
  tokens,
  onRevoke,
}: {
  tokens: ApiTokenInfo[] | null;
  onRevoke: (id: string) => void;
}): React.ReactNode {
  // Widerrufen lässt sich nicht rückgängig machen – deshalb hier ausnahmsweise eine Rückfrage
  // statt Undo: zweimal tippen, am selben Knopf.
  const [confirming, setConfirming] = useState<string | null>(null);

  if (tokens === null) return <p className="mt-3 text-sm text-muted">…</p>;
  if (tokens.length === 0) return <p className="mt-3 text-sm text-muted">{t.api.none}</p>;

  return (
    <>
      <ul className="mt-3 overflow-hidden rounded-md border border-line">
        {tokens.map((token) => (
          <li key={token.id} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{token.name}</p>
              <p className="text-xs text-muted">
                {token.scope === 'write' ? t.api.write : t.api.read} ·{' '}
                {token.lastUsedAt === null
                  ? t.api.neverUsed
                  : t.api.lastUsed(token.lastUsedAt.toLocaleDateString(t.dateLocale))}
              </p>
            </div>
            <Secondary
              type="button"
              onClick={() => {
                if (confirming === token.id) {
                  setConfirming(null);
                  onRevoke(token.id);
                } else {
                  setConfirming(token.id);
                }
              }}
              onBlur={() => setConfirming((current) => (current === token.id ? null : current))}
            >
              {confirming === token.id ? t.api.revokeConfirm : t.api.revoke}
            </Secondary>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t.api.revokeHint}</p>
    </>
  );
}

function CreateForm({
  onCreate,
}: {
  onCreate: (passphrase: string, name: string, scope: ApiTokenScope) => Promise<boolean>;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiTokenScope>('read');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onCreate(passphrase, name.trim(), scope)
          .then((ok) => {
            if (!ok) return;
            setName('');
            setPassphrase('');
          })
          .finally(() => setBusy(false));
      }}
    >
      <h3 className="mb-3 text-heading-14">{t.api.newTitle}</h3>
      <label className="mb-1 block text-overline" htmlFor="api-token-name">
        {t.api.name}
      </label>
      <Input
        id="api-token-name"
        value={name}
        maxLength={60}
        placeholder={t.api.namePlaceholder}
        onChange={(e) => setName(e.target.value)}
      />

      <fieldset className="mt-3">
        <legend className="mb-1 text-overline">{t.api.scope}</legend>
        <div className="flex flex-wrap gap-4">
          {(['read', 'write'] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="api-token-scope" checked={scope === value} onChange={() => setScope(value)} />
              {value === 'write' ? t.api.write : t.api.read}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 mb-1 block text-overline" htmlFor="api-token-passphrase">
        {t.sync.passphrase}
      </label>
      <Input
        id="api-token-passphrase"
        type="password"
        autoComplete="current-password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      <p className="mt-1 text-xs text-muted">{t.api.passphraseHint}</p>

      <Row>
        <Primary type="submit" disabled={busy || name.trim() === '' || passphrase === ''}>
          {t.api.create}
        </Primary>
      </Row>
    </form>
  );
}

/** Nimmt nur, was wirklich da ist: Ohne `build:mcp` liefert der Server statt der Datei die App. */
function useExtensionAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(EXTENSION_URL, { method: 'HEAD' })
      .then((response) => {
        const type = response.headers.get('content-type') ?? '';
        if (!cancelled) setAvailable(response.ok && !type.includes('text/html'));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

function CopyBlock({ text, label }: { text: string; label?: string }): React.ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <pre className="overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap select-all">
        {text}
      </pre>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
        className="mt-1 text-xs text-accent hover:underline"
      >
        {copied ? t.api.copied : t.api.copy}
      </button>
    </div>
  );
}

function CreatedPanel({ token, onDone }: { token: string; onDone: () => void }): React.ReactNode {
  const extension = useExtensionAvailable();
  const npx = { command: 'npx', args: ['-y', 'tidypepple-mcp'], env: { TIDYPEPPLE_TOKEN: token } };

  return (
    <div className="mt-3">
      <h3 className="text-heading-14">{t.api.createdTitle}</h3>
      <p className="mt-1 text-xs text-muted">{t.api.createdHint}</p>
      <CopyBlock text={token} label={t.api.createdTitle} />

      {extension && (
        <>
          <h4 className="mt-4 text-overline">{t.api.setupDesktop}</h4>
          <p className="mt-1 text-xs text-muted">{t.api.setupDesktopHint}</p>
          <a
            href={EXTENSION_URL}
            download="tidypepple.mcpb"
            className="mt-2 inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm transition-colors hover:bg-raised"
          >
            {t.api.download}
          </a>
        </>
      )}

      <h4 className="mt-4 text-overline">{t.api.setupCode}</h4>
      <CopyBlock text={`claude mcp add tidypepple --env TIDYPEPPLE_TOKEN=${token} -- npx -y tidypepple-mcp`} />

      <h4 className="mt-4 text-overline">{t.api.setupOther}</h4>
      <CopyBlock text={JSON.stringify({ mcpServers: { tidypepple: npx } }, null, 2)} />

      <Row>
        <Primary type="button" onClick={onDone}>
          {t.api.done}
        </Primary>
      </Row>
    </div>
  );
}
