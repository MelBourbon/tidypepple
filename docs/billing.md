# Paid sync

> **Optional.** This part only concerns a hosted service that sells sync – like
> <https://app.tidypepple.com>. A self-hosted installation needs none of it:
> `update private.settings set require_subscription = false;` enables sync for all accounts
> (see [Self-hosting](self-hosting.md#5-try-it-out)). Leave `VITE_LEMONSQUEEZY_CHECKOUT_URL`
> empty and don't deploy the `lemonsqueezy-webhook` edge function.

## Sync as a paid feature

Offline, the app is complete and free: capture, projects, board, search, export. Only syncing
between devices and the cloud backup are paid.

This works economically because the app is local-first: **a free user never touches the
server.** They cause no costs, and the free version doesn't have to be artificially limited
to pay off.

### The gate sits on the server

The client is a static PWA – any check there would be cosmetic. Enforcement happens in
`supabase/migrations/0001_schema.sql` in two places, both using the same function
`private.has_active_sync()` (in the `private` schema, not reachable via the REST API):

- **RLS policies** on `records`, separate for reading and writing.
- **`push_records()`**, which raises SQLSTATE `TP001` without entitlement.

The check in the RPC is not a duplicate: the policy alone would let a push affect zero rows.
The client would consider it successful and empty the outbox – silent data loss.

The switch `private.settings.require_subscription` (`0002_sync_settings.sql`) sits in the
same function and therefore applies everywhere at once, including attachments and API
tokens.

### After expiry: pull yes, push no

Anyone who stops paying still has access to **all** their data and can populate a new
device; only uploading is blocked. Everything stays local anyway, and the outbox fills up
instead of discarding changes – after subscribing again, everything is sent.

A cancelled subscription stays entitled until the end of the period. At LemonSqueezy,
`cancelled` means *cancelled, but still running*; what counts is `current_period_end`, not
the status. `past_due` stays entitled too – an expired card shouldn't cut off sync
immediately.

### Billing

Merchant of record: **LemonSqueezy** handles EU VAT, OSS reporting and invoices. Paddle
would be equivalent; `subscriptions.provider` keeps the switch open, and only the webhook and
the checkout call would need replacing. Setup: see [Setup: LemonSqueezy](#setup-lemonsqueezy)
below.

**Manual unlock** for refunds, test accounts or friends:
`update public.profiles set plan = 'premium' where id = '<user-id>';` – takes effect
immediately, without touching the payment provider.

### Legal

Once money flows and you sell to consumers in the EU, you need a legal notice (Impressum),
privacy policy, terms and a cancellation policy. In Germany, the buy button must explicitly
state the obligation to pay (§ 312j BGB) – which is why the German label is
“Zahlungspflichtig bestellen”. The merchant of record takes care of VAT and invoices, **not**
of these obligations. This is not legal advice; please have it checked professionally.

## Setup: LemonSqueezy

LemonSqueezy acts as **merchant of record**: it formally sells to your customers and thereby
handles EU VAT, OSS reporting, invoices and reverse charge.

> Check beforehand whether the terms still suit you – LemonSqueezy now belongs to Stripe.
> Paddle would be the equivalent replacement; only the webhook and the checkout call would
> need replacing, and `subscriptions.provider` keeps the switch open.

### 1. Create a product

Create a store with a **subscription** product of the desired term (monthly and/or yearly).
Each price variant has its own ID – you'll need it shortly.

To try things out, switch to **test mode** at the top right. Test purchases work with the
card number `4242 4242 4242 4242` and any future expiry date.

### 2. Add the checkout URL

On the variant, *Share → Copy checkout URL*. In `.env`:

```bash
VITE_LEMONSQUEEZY_CHECKOUT_URL=https://<store>.lemonsqueezy.com/buy/<variant-uuid>
```

Buying is possible **before** signing in (“pay first, sign in later”):

- **Not signed in:** the app opens the bare checkout URL. The subscription is then tied to
  the email address from the order; the webhook sends a sign-in link to that address, and
  whoever signs in with it is entitled immediately (`has_active_sync`, matched via the
  confirmed email).
- **Signed in:** the app appends `checkout[custom][user_id]` and prefills `checkout[email]`.
  The subscription is then tied directly to the account, regardless of the address.

Matching by email is safe because sign-in works via magic link: an account with that address
proves its owner controls the mailbox. If a buyer signs in with a different address, they see
the purchase prompt with a hint to sign in with the address from the order.

The hosted checkout page is used deliberately instead of the overlay: the overlay loads
third-party script and opens an iframe, which would require loosening the Content Security
Policy. This way it stays untouched.

**Redirect after purchase:** on the variant, under *Confirmation modal → Button link*, enter
`https://<your-app-address>/?checkout=done`. The PWA takes the parameter from the address
and re-checks the subscription status up to three times, 5 seconds apart
(`src/billing/checkoutReturn.ts`), because the webhook may arrive a bit later. The same
happens when you return to the tab manually shortly after clicking “Buy”.

**Android app for direct download** (hosted version only, separate non-public repository,
platform `android`): it buys
through the same checkout. The wrapper opens it in a Custom Tab, and the redirect to
`/?checkout=done` brings the app back to the front via App Link. The customer portal is
linked there as well. Only a future app from Google Play (platform `twa`) sells via Play.

### 3. Set up the webhook

Deploy the edge function first. The Supabase CLI doesn't need to be installed; `npx` fetches
it on demand (run `npx supabase login` once beforehand):

```bash
npx supabase link --project-ref <project-ref>
npx supabase secrets set LEMONSQUEEZY_SIGNING_SECRET=<any long random secret>
npx supabase secrets set LEMONSQUEEZY_VARIANT_IDS=<variant-id>[,<variant-id>…]
npx supabase secrets set APP_URL=https://<your-app-address>
npx supabase secrets set LEMONSQUEEZY_ALLOW_TEST_MODE=true   # only while in test mode
npx supabase functions deploy lemonsqueezy-webhook --no-verify-jwt
```

`LEMONSQUEEZY_VARIANT_IDS` are the numeric IDs of the sync subscription's price variants (on
the product under *Variants*, or as `variant_id` in a webhook event), comma-separated – test
mode and live mode have different IDs, and both belong in the list. A webhook receives the
subscriptions of the *entire* store; without this list, any other subscription in the store,
such as one for a second app, would unlock sync. If the value is missing, the webhook rejects
every event with 500 (LemonSqueezy retries later); subscriptions of other variants are
acknowledged with 200 and logged as “Ignoriert” (ignored).

Without `LEMONSQUEEZY_ALLOW_TEST_MODE=true`, the webhook only acknowledges test purchases
(`meta.test_mode`) and writes nothing – a free test purchase shouldn't grant entitlement in
production. So enable it for trying things out and remove it before going live.

`APP_URL` is the target of the sign-in link the webhook sends after a purchase without an
account. It must be allowed as a redirect URL in Supabase under *Authentication → URL
Configuration*. If it is missing, no email goes out – but the buyer can still sign in with
the order email themselves. For real customers, configure your own SMTP server in Supabase;
the built-in sending is heavily throttled.

`--no-verify-jwt` is required because LemonSqueezy doesn't send a Supabase token.
Authentication happens via the HMAC signature – it is the **only** security boundary of this
function.

Then create a webhook in LemonSqueezy under *Settings → Webhooks*:

- **URL**: `https://<project>.supabase.co/functions/v1/lemonsqueezy-webhook`
- **Signing secret**: exactly the same value as above
- **Events**: `subscription_created`, `subscription_updated`, `subscription_cancelled`,
  `subscription_resumed`, `subscription_expired`, `subscription_paused`,
  `subscription_unpaused`

`subscription_payment_*` is not needed: these events carry an invoice instead of a
subscription, and whatever a payment changes about the subscription also arrives as
`subscription_updated`. If they are subscribed, the webhook just acknowledges them.

### 4. Verify the flow

First check whether the function runs and is configured (no signature, changes nothing):

```bash
curl -i https://<project>.supabase.co/functions/v1/lemonsqueezy-webhook   # 200 OK
```

503 means: a secret is missing or the database is unreachable; the reason is in the log.

Then make a test purchase, and afterwards:

```sql
select user_id, email, status, provider_status, current_period_end from public.subscriptions;
select private.has_active_sync('<user-id>');
```

Buy once without signing in (row with `user_id = null` and the order email; the sign-in link
arrives by email) and once signed in (row with `user_id`).

Tap *Refresh status* in the app – the indicator must switch from “Read only” to “In sync”,
and pending changes are sent.

If nothing arrives: `supabase functions logs lemonsqueezy-webhook`. The most common causes
are a mismatched signing secret (response 401), a test purchase without
`LEMONSQUEEZY_ALLOW_TEST_MODE=true` (response 200 “Ignoriert”, no row) and a missing `APP_URL`
(subscription is written, but no sign-in email is sent). If the email doesn't arrive despite
`APP_URL`, the reason is in the log under “Anmeldelink nach Kauf nicht verschickt”.

### 5. Before going live

Test and live mode are separate worlds at LemonSqueezy: products, variants, checkout URLs and
webhooks from test mode don't exist in live mode. Nothing changes in the code, but:

1. **Get the account activated**: complete payout details and tax information.
2. **Move the product to live mode** (on the product, *Copy to live mode*, or create it anew)
   and publish it. The live variant has a different UUID and a different variant ID – append
   the latter to `LEMONSQUEEZY_VARIANT_IDS`.
3. **Swap the checkout URL**: set `VITE_LEMONSQUEEZY_CHECKOUT_URL` to the live variant's
   address, then `npm run build` and deploy – the value is baked into the bundle.
4. **Create the webhook again in live mode** with the same settings as in step 3. With the
   same signing secret, `LEMONSQUEEZY_SIGNING_SECRET` in Supabase stays unchanged.
5. **Disable test mode in the webhook and remove test subscriptions.**

   ```bash
   npx supabase secrets unset LEMONSQUEEZY_ALLOW_TEST_MODE
   ```

   After that, the webhook no longer accepts test purchases. Test subscriptions already
   written remain in `public.subscriptions`, though, and stay entitled until
   `current_period_end`:

   ```sql
   select provider_sub_id, user_id, email, status, current_period_end from public.subscriptions;
   delete from public.subscriptions where provider_sub_id in ('<test-sub-id>', ...);
   ```

6. **Configure your own SMTP server** in Supabase (*Authentication → Emails*) if you haven't
   already. With the throttled built-in sending, sign-in links after a purchase without an
   account may otherwise not arrive.
7. **Run a real purchase** as in step 4 and refund it afterwards in the LemonSqueezy
   dashboard.
