# API and MCP server

Scripts and AI assistants should be able to reach the tasks – for syncing with GitHub or
Trello via tags, or so that Claude can read and create tasks.

A classic REST API on the server is impossible: the server only sees ciphertext, not even
whether a record is a task or a context. The API is therefore an **MCP server that runs on
the user's machine** (`mcp/`). It is another device of the vault, decrypts locally and talks
to Supabase just like the app. The same tools are used by LLMs (Claude Desktop, Claude Code,
Cursor …) and by scripts calling through an MCP client SDK – examples in
[`mcp/README.md`](../mcp/README.md), a GitHub sync via `#github` in
[`mcp/examples/github_sync.py`](../mcp/examples/github_sync.py).

It is **distributed** twice from the same bundle `mcp/dist/server.mjs`:

- as the **Claude Desktop extension** `tidypepple.mcpb` – double-click, paste the token. The
  app offers it for download (see [Self-hosting → Updating](self-hosting.md#4-updating)).
- as the **npm package** `tidypepple-mcp` for `npx -y tidypepple-mcp`.

### API tokens

Instead of passphrase and sign-in, the MCP server needs a token from *Settings → API access*
(only with sync enabled for the account and an unlocked vault). It has three parts:

```
tp1.<id>.<authSecret>.<keySecret>
```

- `authSecret` is sent with every request; the server only knows its SHA-256 hash.
- `keySecret` never leaves the machine. It (via HKDF) wraps the vault key stored on the
  server – so the server can't open it.
- To wrap it, the app asks for the passphrase once, because the stored `CryptoKey` is not
  extractable.

The functions `api_session`, `api_pull`, `api_push` and `api_epoch` can be called by `anon`,
because the token is the credential – no edge function is needed. Each first checks the
token, vault membership and **sync entitlement** (`private.has_active_sync`): unlike sync,
the API returns nothing at all without it, not even read-only. On the hosted service that
means a subscription; with `require_subscription = false` every account is entitled. A
read-only token can't push (`TP005`), and the MCP server doesn't even offer it the writing
tools. At most ten tokens per account.

**Revoking** deletes the row including the wrapped key and blocks access immediately.
Whatever was already fetched with the token stays readable for its holder – that would take
a rotation of the vault key, which doesn't exist yet.

### What the MCP server can do

Read: `list_tasks` (filter by view, status, tag, context, project, full text), `get_task`,
`list_projects`, `list_contexts`, `list_tags`, `changes_since` (for sync scripts).
Write: `add_task` (capture syntax), `update_task`, `complete_task`, `reopen_task`,
`delete_task`. Every tool has a fixed `outputSchema` and returns `structuredContent` – so
names and fields only change additively.

- The vault lives in memory (`fake-indexeddb`). At startup, the server fetches everything;
  after that, before a reading tool if the state is older than 10 s, and after every writing
  one. Nothing stays on disk in plain text.
- `changes_since` counts with its own counter, not via the HLC: an offline change arrives
  with an older timestamp and would otherwise slip through. The cursor is valid for one
  process only; after a restart, everything comes with `reset: true`.
- `TIDYPEPPLE_ONLY_TAG=ai` limits the view to tasks with this tag; new tasks get it
  automatically. This guards against sending too much context to the LLM provider, but it is
  not a security boundary – the server holds the entire vault key.
- Mappings to GitHub or Trello are stored by the script itself, not in the task:
  `normalizeTask` discards unknown fields, and older app versions would delete them.
- Attachments: metadata only, no files.

### Build and publish

```bash
npm run build:mcp                 # mcp/dist/server.mjs + mcp/tidypepple-<version>.mcpb
cd mcp && npm publish             # npm package tidypepple-mcp (version from mcp/package.json)
```

Supabase URL and anon key are baked in from `.env`, as for the app. The version lives only in
`mcp/package.json`; `scripts/pack-mcp.mjs` copies it into the extension's manifest.
