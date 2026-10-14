# Security policy

TidyPepple stores end-to-end encrypted data, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue. Instead, report it privately:

- via GitHub: *Security → Report a vulnerability* in this repository, or
- by email to **tidypepple@roeslr.com**.

Please include what is affected (app, sync backend, MCP server), steps to reproduce, and the
impact you expect. You will get an answer within a few days.

## Scope

Of particular interest:

- anything that lets the server or a third party read plaintext task data,
- bypassing row-level security or the sync entitlement in `supabase/migrations/`,
- leaking or misusing API tokens of the MCP server.
