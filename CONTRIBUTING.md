# Contributing

Thanks for your interest in TidyPepple!

## Before you start

- **Bugs and ideas** go to the [GitHub issues](https://github.com/MelBourbon/tidypepple/issues).
  For bugs, include the app version (*Settings → About*), the platform, and steps to
  reproduce. The in-app *Feedback* button and *Report the problem* on the error screen
  lead there too.
- For larger changes, open an issue first. TidyPepple is deliberately minimal, and
  not every feature fits.

Issues and pull requests can be written in English or German.

## Setup

```bash
npm install
npm run dev
```

Without a `.env`, the app runs purely locally. Sync needs a Supabase project, see
[docs/self-hosting.md](docs/self-hosting.md).

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build && npm run e2e
./supabase/tests/run.sh     # only if you touched supabase/ (needs Docker)
```

CI runs the same checks on every pull request.

- **Database changes** go into a new file in `supabase/migrations/` (`0002_…`, `0003_…`).
  Never edit a migration that has already been released. Add a test in `supabase/tests/`.
  A new table in `public` needs its `grant`s in the same migration: Supabase no longer
  grants anything on new tables automatically (see `0003_explicit_grants.sql`).
- **User-facing strings** belong in `src/i18n/de.ts` (the reference) and `src/i18n/en.ts`.
- **UI** follows [docs/styleguide.md](docs/styleguide.md). Use rem instead of px for text
  sizes.
- Code comments explain *why*, not *what*. Existing comments are in German; either language
  is fine for new ones.

## Versions and releases

Versions are git tags `vX.Y.Z`: minor for new features, patch for fixes. Each tag gets a
[GitHub release](https://github.com/MelBourbon/tidypepple/releases) with the tag message as
notes. `package.json` is not maintained; the app shows the output of `git describe --tags`
(see `vite.config.ts`). The hosted Android app has its own version numbers (2.x).

## License

By contributing, you agree that your contributions are licensed under the
[AGPL-3.0](LICENSE).
