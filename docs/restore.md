# Restoring the Supabase database

A backup is only worth something once a restore has worked. This guide covers the backup,
the restore, and a drill you can run without touching the real project.

## What is backed up at all?

| What | Where | In the backup? |
|---|---|---|
| Tasks, contexts (encrypted) | `public.records` | yes |
| Vaults, keyring (wrapped), subscriptions, profiles | `public.*` | yes |
| Accounts | `auth.users` | yes, with Supabase backups |
| Attachment files | Supabase Storage (S3) | **no** – only their metadata in `storage.objects` |

**Supabase only backs up from the Pro plan on** (daily backups, 7 days). The free plan has no
backups. In that case, back up the database yourself, e.g. nightly via cron:

```bash
export PGPASSWORD='<db-password>'
DB_URL='postgresql://postgres.<project-ref>@<pooler-host>:5432/postgres'
npx supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
npx supabase db dump --db-url "$DB_URL" -f schema.sql
npx supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only
```

The password goes in via `PGPASSWORD`, not in the URL: command-line arguments are visible to
every local user via `ps`.

Ready for cron, with retention period and optional Uptime Kuma ping:
[`deploy/backup/supabase-backup.sh`](../deploy/backup/supabase-backup.sh) (setup instructions
in the script header).

The connection string is under *Project Settings → Database → Connection string* (session
pooler). The dumps contain encrypted records, but also email addresses and subscriptions:
store them like any other backup containing personal data.

The devices themselves are the second backup: every synced device holds the complete state
in plain text in IndexedDB. The restore below builds on exactly that.

## Restore

### 1. Load the backup

- **Supabase backup:** *Database → Backups* → choose a point in time → *Restore*. The project
  is unreachable meanwhile; the apps keep working offline.
- **Your own dump:** into a project without data (newly created or emptied):

  ```bash
  psql --single-transaction --variable ON_ERROR_STOP=1 \
    --file roles.sql --file schema.sql \
    --command 'SET session_replication_role = replica' \
    --file data.sql --dbname "$DB_URL"
  ```

  A new project has a new URL and a new anon key: update `.env`, rebuild, deploy, and – if
  you sell subscriptions – change the webhook URL in LemonSqueezy and set the edge function's
  secrets again (see [Setup: LemonSqueezy](billing.md#setup-lemonsqueezy)).

### 2. Immediately afterwards: a new server epoch

In the SQL editor:

```sql
select private.rotate_sync_epoch();
```

**This step is not optional.** Devices only fetch records with a `server_seq` above their
cursor; after the restore, the sequence is back at the backup's state, i.e. below it. Without
a new epoch, devices would never see new changes, and none would re-upload what was lost
since the backup – they would silently drift apart.

With a new epoch, every device resets its cursor on the next sync, pushes all tasks and
contexts (including deletions) once more and then fetches everything from 0 (`checkEpoch` in
`src/sync/engine.ts`, `resyncAll` in `src/data/repo.ts`). The server discards older versions
via the HLC comparison. Only what existed solely on the server since the backup is lost –
that is, nothing, as long as the device that wrote it still exists.

If the function is missing, the backup predates the server epoch: apply the missing
migrations first (step 3), then rotate.

### 3. Check the migrations

A backup from before a migration doesn't have its state. Go through the files in
`supabase/migrations/` and run again whatever was applied after the backup was taken. Spot
checks:

```sql
select to_regprocedure('public.sync_epoch()');                         -- server epoch (0001)
select pg_get_functiondef('private.has_active_sync(uuid)'::regprocedure)
  like '%email_confirmed_at%';                                          -- confirmed email (0001)
select to_regclass('private.settings');                                 -- sync settings (0002)
```

If `0002_sync_settings.sql` has to be applied again, `require_subscription` is back to
`true` afterwards – on a self-hosted installation, switch it off again.

### 4. Catch up on subscriptions

Webhook events since the backup are missing from `public.subscriptions`. In LemonSqueezy,
under *Settings → Webhooks*, resend the events since the backup time. Duplicate or older
events are harmless: `apply_subscription_event` discards anything not newer than the stored
state. Until then, affected buyers see “Read only”; pulling keeps working.

If a subscription belongs to an account created only after the backup, that account no
longer exists. The event is then stored without an account and applies via the order email
as soon as the buyer signs in again with that address.

### 5. What users notice

- **Accounts created after the backup** no longer exist. Their devices are signed out; after
  signing in again with the same address, the app recreates the vault from the local keyring
  (`SyncProvider`), and passphrase and recovery key remain valid. A subscription bought
  without an account is tied to the email and applies again.
- **Attachments:** every device uploads the files it has once more. If a file is missing on
  all devices, it stays “not uploaded yet”.
- After the restore, every device uploads everything once. With large vaults and many
  attachments, that can take a while.

## Drill

Once a quarter and after every migration that changes tables. Takes about 30 minutes and
doesn't touch the real project.

1. Create a new Supabase project, e.g. *tidypepple-restore-drill*.
2. Take a dump of the real project as above and load it there.
3. `select private.rotate_sync_epoch();`
4. Check:

   ```sql
   select count(*) from auth.users;                -- same as in the real project
   select count(*) from public.vaults;
   select count(*), max(server_seq) from public.records;
   select last_value from public.records_seq;      -- >= max(server_seq)
   select count(*) from public.subscriptions where status = 'active';
   ```

5. Build locally against the drill project (`.env` with its URL and anon key,
   `npm run dev`), sign in with your own account in a fresh browser profile and unlock with
   the passphrase. The tasks must appear.
6. Note the result and date in your operations log, then delete the drill project.
