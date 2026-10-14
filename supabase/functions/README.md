# Edge functions

Only needed for selling sync as a subscription (see [docs/billing.md](../../docs/billing.md)).
A self-hosted installation with `require_subscription = false` doesn't need them.

## lemonsqueezy-webhook

Receives subscription events and maintains `public.subscriptions`. The entitlement itself is
evaluated by `private.has_active_sync()` – the webhook only writes state, it decides nothing.

```bash
supabase secrets set LEMONSQUEEZY_SIGNING_SECRET=<signing secret from the LS dashboard>
supabase secrets set LEMONSQUEEZY_VARIANT_IDS=<variant-id>[,<variant-id>…]   # required
supabase secrets set APP_URL=https://<your-app-address>
supabase secrets set LEMONSQUEEZY_ALLOW_TEST_MODE=true   # only while in test mode
supabase functions deploy lemonsqueezy-webhook --no-verify-jwt
```

Register the function's URL as a webhook in the LemonSqueezy dashboard and subscribe to
these events: `subscription_created`, `subscription_updated`, `subscription_cancelled`,
`subscription_resumed`, `subscription_expired`, `subscription_paused`,
`subscription_unpaused`.

Only subscription objects (`data.type = subscriptions`) of the variants in
`LEMONSQUEEZY_VARIANT_IDS` are considered – the webhook sees all subscriptions in the store.
`subscription_payment_*` carries an invoice instead of a subscription and is only
acknowledged. Without `LEMONSQUEEZY_VARIANT_IDS`, the webhook responds with 500.

Events from LemonSqueezy's test mode (`meta.test_mode`) are acknowledged with 200 but not
written unless `LEMONSQUEEZY_ALLOW_TEST_MODE=true`.

`--no-verify-jwt` is required because LemonSqueezy doesn't send a Supabase token.
Authentication happens via the HMAC signature – it is the only security boundary.

**Monitoring:** a `GET` on the function URL responds with 200 if all secrets are set and the
database is reachable, otherwise with 503 (reason in the log). Set up an HTTP monitor for it
(e.g. in Uptime Kuma), interval about 5 minutes. A `GET` changes nothing and needs no
signature.

Purchases are assigned via `checkout[custom][user_id]` if the buyer was signed in, otherwise
via the email address from the order. In the second case, the webhook sends a sign-in link
to that address after `subscription_created` (only if `APP_URL` is set).

The testable logic (signature, status mapping, parsing) lives in `_shared/lemonsqueezy.ts`
and is covered by `tests/unit/lemonsqueezy.test.ts`.
