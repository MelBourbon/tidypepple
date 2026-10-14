# Architecture

```
src/domain/   pure logic, no IO: GTD rules, sorting, HLC, quick-add parser
src/data/     Dexie (IndexedDB) + repository; every mutation stamps an HLC and fills the outbox
src/crypto/   envelope encryption, vault key, recovery key
src/sync/     SyncAdapter interface, Supabase backend, push/pull/merge, subscription state
supabase/     migrations, edge functions (webhook), SQL tests
src/routes/   views
src/i18n/     all user-facing strings: de.ts (reference), en.ts, selection in index.ts
scripts/      build configuration check (`npm run check:env`, see self-hosting)
server/       small test server for the LAN – not needed in production, see self-hosting
deploy/       nginx example configuration, database backup script
```

The UI reads and writes **only** IndexedDB. The network is never in the request path – that
is why the app works exactly the same in airplane mode, and sync is an add-on, not a rebuild.

### Why HLC and outbox from the start

Every record carries a hybrid logical clock timestamp, every change marks the record in an
outbox, and deleting is always a soft delete. That costs almost nothing and is what allowed
sync to be added without a data migration.

### One device, one vault

Pull cursor, server epoch and outbox only apply to the vault the device last synced with
(`bindVault` in `src/data/repo.ts`, meta key `syncVaultId`). If a different account signs in
on the same device, the first sync run discards tasks, contexts, files and outbox of the old
vault and fetches the new one from 0. Without this binding, the pull would continue at the
old vault's cursor and the new vault's older records would never arrive; the old account's
tasks would move into the new vault with the next edit. Data created purely locally is not
affected: it belongs to the first vault the device joins and goes up with the outbox.

## Tombstones

Deleting is a soft delete; otherwise it couldn't be synced. The row in `records` therefore
stays forever.

It is small, though: a deletion goes out as its own encrypted tombstone that carries only
the deletion time and HLC – no title, no notes, no contexts. The content of a deleted task
never leaves the device in the first place. The plain-text column `deleted` additionally
tells the server *which* records are deleted and when. Compared with what it sees anyway
(IDs, write times, count, and via UUIDv7 the creation time), that is a small addition.

The point is that the deletion's HLC sits *inside* the ciphertext. A cleanup job
(`compact_tombstones`) used to empty the ciphertext of old deletions, and the client applied
an empty `ct` as a deletion. But the clock for it was only in the plain-text column: anyone
able to write to the database could have deleted any task on all devices. That job no longer
exists, and the client skips empty ciphertext like an unreadable record.

> Legacy: tombstones from before this change still carry their encrypted content. Rows that
> were already emptied can't be applied by a device that hasn't seen them yet. On that
> device, the task lives on until someone deletes it again.

On the device itself, `purgeLocalTombstones()` removes tombstones older than 90 days at
startup. Records still in the outbox are excluded, because nobody else knows about their
deletion. The retention period is in `src/data/bootstrap.ts`.

## Tests

```bash
npm test                    # unit tests: GTD rules, HLC merge, crypto, sync, webhook, configuration
npm run e2e                 # E2E tests, each in phone and desktop emulation
./supabase/tests/run.sh     # SQL tests against real Postgres in a container (needs Docker)
```

`npm run e2e` tests the build in `dist/`. Some tests expect an app without Supabase – with a
local `.env` in place, build like this:
`VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_LEMONSQUEEZY_CHECKOUT_URL= VITE_BEACON= npm run build`.

**CI:** `.github/workflows/ci.yml` runs typecheck, unit tests, build, E2E, SQL tests and
`deno check` of the edge function on every push and pull request. To keep anything red out
of `master`, add a rule for `master` under *Settings → Branches*: *Require a pull request
before merging* and *Require status checks to pass* with the jobs *Typecheck, Unit-Tests,
Build*, *E2E (Playwright)*, *SQL-Tests (Postgres)* and *Edge Function (Deno)*.

The SQL tests check the authorization logic on the migration itself rather than on a
JavaScript replica – a replica could stay green while the migration is wrong. This has paid
off: the very first run revealed that cancelled subscriptions would have been blocked
immediately instead of running until the end of the period.

Among other things, the E2E suite checks real offline work including a reload without
network; the unit suite checks convergence of two devices, tombstones, discarded late
arrivals, and that tampered ciphertext or ciphertext moved to another record is rejected.
