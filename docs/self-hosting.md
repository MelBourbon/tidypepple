# Self-hosting

Without a backend, TidyPepple runs entirely in the browser – just serve the static build.
Sync needs a [Supabase](https://supabase.com) project. Selling sync as a subscription is
optional and described separately in [billing.md](billing.md).

## Setup: Supabase

### 1. Create a project

Create a project on supabase.com. Pick a region as close to your users as possible – it
determines the latency of every sync run.

### 2. Apply the migrations

`supabase/migrations/0001_schema.sql` is the complete state of the database: tables, RLS
policies, sync functions, subscriptions, attachments, server epoch and API tokens. Run the
file in the SQL editor, then every newer file (`0002_…`, `0003_…`) in order.

The Supabase CLI does both in one step:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`select public.sync_epoch();` tells you whether everything is in place – the function is
defined near the end of the schema and returns a UUID.

### 3. Authentication

Under *Authentication → URL Configuration*:

- **Site URL**: the address the app runs at, e.g. `https://tidypepple.example.com`
- **Redirect URLs**: also add every test address, such as `https://<lan-ip>:5176` and
  `http://localhost:5173`

If an address is missing here, the sign-in link leads nowhere – with an error message that
doesn't reveal why.

Under *Authentication → Emails*, include the code in the **Magic Link** and **Confirm
signup** templates (on the very first sign-in, Supabase creates the account and then sends
*Confirm signup*), for example:

```html
<h2>Sign in to TidyPepple</h2>
<p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
<p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
```

The code is needed because an installed home-screen app (especially on iOS) has its own
storage: the link opens in the browser and signs in there, not in the app. After sending,
the app therefore offers a field for the code.

> **Sending email:** Supabase's built-in SMTP service is heavily rate-limited (a few emails
> per hour) and explicitly meant for trying things out only. For real users, configure your
> own SMTP provider under *Authentication → Emails*, or sign-in links will sporadically not
> arrive at all.

### 4. Add the keys

From *Project Settings → API*, into `.env` (template: `.env.example`):

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

> **Never put the `service_role` key into `.env`.** Everything prefixed with `VITE_` is
> baked into the build and thus public. The `service_role` key bypasses all RLS – it belongs
> only in the Supabase secrets of the edge function.

`VITE_*` variables are inserted at build time, not read at runtime: run `npm run build` again
after every change.

`npm run check:env` tells you whether the values are right – without building. It checks
what can be detected from the values themselves: role, project and expiry of the key, typos
in the URL (such as the dashboard address instead of the API URL), unreplaced placeholders,
and key and URL from different projects. The same check runs on every `npm run build` and
aborts it, instead of producing a bundle in which sync is silently missing.

### 5. Try it out

Open the app → *Settings → Sync* → request a sign-in link → create a vault → **save the
recovery key** (it is shown exactly once).

Sync then shows “Read only”, because by default the database requires a subscription. For
your own installation, turn that requirement off once – every account may then sync, and
LemonSqueezy, the webhook and a checkout URL are not needed:

```sql
update private.settings set require_subscription = false;
```

Tap *Refresh status* in the app; the indicator switches to “In sync”.

To keep the requirement and only unlock individual accounts (for testing, say):

```sql
update public.profiles set plan = 'premium' where id = '<user-id>';
```

The user ID is under *Authentication → Users*. To sell subscriptions yourself, see
[Paid sync](billing.md).

## Deploying on your own server

**TidyPepple has no server component.** The build is a folder of static files; everything
else happens in the browser (IndexedDB) and optionally at Supabase. So there is no Node
process in production, no database and no reverse proxy in front of an application – nginx
serves `dist/` directly.

**HTTPS is mandatory, not optional.** Without a valid certificate, the service worker
doesn't register: no offline mode, no installation on the home screen – exactly the two
properties a PWA is built for.

Three things are not in the repository and must be set once per server. Everything else
comes from `git pull`:

| What | Where | Check with |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` on the server | `npm run check:env` |
| Migrations (`0001_schema.sql` and newer) | Supabase, SQL editor or `supabase db push` | `select public.sync_epoch();` |
| The server's address as redirect URL | Supabase, *Authentication → URL Configuration* | request a sign-in link |

Without the redirect URL, the sign-in link leads nowhere – and the error message doesn't
say why. The address itself is in no configuration file: the app sends its own origin
(`window.location.origin`) as the target; Supabase only has to allow it.

### 1. Requirements

- nginx
- Node ≥ 22 – only for building; no Node runs in production.
  (Vite would manage with 20.19, but `@supabase/supabase-js` and Vitest require 22.)
- A hostname pointing to the server, plus a certificate (below with certbot)

### 2. Build

```bash
cd /srv/tidypepple
npm ci
cp .env.example .env   # first time only
$EDITOR .env           # enter Supabase URL and anon key
npm run check:env      # checks the values without building
npm run build          # creates dist/
```

`.env` must be in place **before** the build: `VITE_*` variables are baked in, not read at
runtime. The build log names the project it builds against and aborts on unusable values.
Without `.env`, on the other hand, you deliberately get a purely local build – a valid state
that is also noted in the log.

nginx (user `www-data`) must be able to read `dist/`:

```bash
sudo chmod -R a+rX /srv/tidypepple/dist
```

### 3. Set up nginx

A ready-made file is in [`deploy/nginx/tidypepple.conf`](../deploy/nginx/tidypepple.conf).
Adjust `server_name` and the two certificate paths, then:

```bash
sudo cp deploy/nginx/tidypepple.conf /etc/nginx/sites-available/tidypepple
sudo ln -s ../sites-available/tidypepple /etc/nginx/sites-enabled/tidypepple
sudo nginx -t
sudo systemctl reload nginx
```

Get a certificate:

```bash
sudo certbot --nginx -d tidypepple.example.com
```

The file is extensively commented: caching per path, Content Security Policy, HSTS, SPA
fallback, plus the Digital Asset Links of the Android app and a note on the optional start
ping (`VITE_BEACON`). Whatever you don't need can go. Why the remaining parts look the way
they do is explained under [The three pitfalls](#5-the-three-pitfalls).

### 4. Updating

```bash
cd /srv/tidypepple && git pull && npm ci && npm run build:mcp && npm run build
```

`npm run build:mcp` is optional: it builds the Claude Desktop extension with the same `.env`
and puts it into `public/downloads/`, from where the app offers it under *Settings → API
access*. Without this step, only the download button is missing there.

`.env` is not in the repository and is never touched by `git pull`; the build log names the
target project every time. No nginx reload is needed – only files are replaced. Open tabs
get a “New version available” notice and reload on click; the update is not forced, because
a reload in the middle of capturing feels like data loss.

### 5. The three pitfalls

All three were measured against the configuration above and are already solved there.

**The service worker must not be cached.** If `sw.js` is served with a normal cache header,
updates never reach users – the app stays on an old version for good. The same applies to
`index.html`. Files in `/assets/`, on the other hand, carry a content hash in their name and
may stay cached for a year.

**`add_header` in a `location` block discards all inherited headers.** If Cache-Control is
set per `location` and the security headers at server level, Content Security Policy and HSTS
are missing on exactly `index.html` and `sw.js` – measured: the CSP only arrived on
`/favicon.svg`. That is why a `map` controls caching and there is exactly one set of
`add_header`.

**The CSP must allow `'wasm-unsafe-eval'`.** The passphrase is derived with Argon2id as
WebAssembly. Without this source, unlocking the vault fails with
`Compiling or instantiating WebAssembly module violates ... Content Security Policy` – and
only when someone tries to unlock their vault, not at deployment.

### Variant: behind a reverse proxy

Only worthwhile if a process is running anyway – such as the test server in
`server/index.js`. Serving statically is faster and has fewer moving parts.

```nginx
location / {
    proxy_pass http://127.0.0.1:5175;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The caching and security headers from above still belong in the server block –
`server/index.js` only sets the bare minimum.

## Testing on the LAN

For testing without a public hostname, a systemd service serves the built app on the local
network (`server/index.js`, no dependencies):

| Address | Purpose |
|---|---|
| `http://<lan-ip>:5175` | Opens immediately, no certificate warning |
| `https://<lan-ip>:5176` | Required for service worker, offline mode and installing |

```bash
npm run build                          # rebuild dist/
sudo systemctl restart tidypepple      # serve the changes
sudo journalctl -u tidypepple -f       # log
```

The unit template is [`server/tidypepple.service`](../server/tidypepple.service).

### Why the LAN needs a certificate

A self-signed certificate is **not** enough: Chrome refuses to register the service worker
with untrusted certificates, even after clicking through the warning (`An SSL certificate
error occurred when fetching the script`). That is why a small local CA signs the server
certificate. It must be installed once per test device:

1. Open `http://<lan-ip>:5175/ca.crt` on the device.
2. **iOS:** install the profile, then *Settings → General → About → Certificate Trust
   Settings* → enable full trust (this second step is often overlooked; without it, nothing
   changes).
   **Android:** *Settings → Security → Encryption → Install a certificate → CA certificate*.
   **macOS/Linux/Windows:** import it into the system or browser certificate store.
3. Then open `https://<lan-ip>:5176`.

The CA lives in `server/certs/` and is deliberately not in the repository – it contains
private keys. It can be regenerated at any time; the old one on the devices then becomes
worthless.

For development with hot reload, use `npm run dev -- --host` (port 5173) instead. The
service worker is disabled there, so a stale cache doesn't get in the way.
