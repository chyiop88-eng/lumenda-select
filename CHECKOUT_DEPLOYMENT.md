# LUMENDA SELECT · Checkout V14 merchant handover

**Status:** implemented and tested on GitHub feature branch; **not yet deployed to the production Render application**, and **not connected to a real Stripe merchant**. No real charge has been made. Preserve the existing live database and site until an authorized deployment.

## What passed automated checks

The workflow at `.github/workflows/cart-payments-ci.yml` creates a disposable PostgreSQL 16 database and fake local Stripe API. It verifies:

- FTE230 unit price **HK$899**, quantity limits 1–30, and server-calculated line totals.
- GENOPTICS50 is **quote-only**. Its price is entered per item by the owner, never assumed to be zero.
- Admin quote must equal the server's saved cart lines; invented HK$4,000 subtotal for a single HK$899 item is rejected.
- Merchandise subtotal **>= HK$4,000** means HK$0 shipping, but any destination-specific tax is still payable. Below threshold, seller enters real shipping and tax.
- Order submission persists cart snapshots, admin quote persists the matching line breakdown, receipt displays the same confirmed amount.
- Stripe Checkout payload uses server-quoted HKD minor units; fake gateway receives the exact amount.
- Webhooks require signed raw payload, a timestamp within 5 minutes, matching order ID, session ID, quote fingerprint, HKD currency, mode, environment and paid total.
- Tampered webhook signatures, mismatched amounts, duplicate receipts, double-click checkout, quote edits after verified payment, and checkout after paid are rejected or handled idempotently.
- Prior CRM, bot, agent-referral, media manager and payment-link regressions.

**Important distinction:** passing these checks does not mean payment through a real Stripe sandbox or production merchant has been confirmed. Live settlement, chargeback handling and merchant eligibility require merchant activation and an end-to-end gateway test.

## Connected flow

1. Shopper fills the storefront cart and submits a **no-charge order enquiry**. A private receipt token is generated.
2. Owner opens `/admin`, reviews the original order, confirms stock, fills any unpriced product's unit price and destination tax/shipping. Known FTE unit price is locked to HK$899.
3. Server rejects a quote that does not equal its SKU * quantity calculation. It stores item lines, subtotal, shipping, tax and final total.
4. If owner supplied a manual PayPal/Stripe Payment Link, the existing **manual-verification** flow is used instead.
5. When a confirmed quote has **no external payment link** and Stripe is configured, the private `/order#token` page offers card checkout. Request `POST /api/order/checkout` authenticates by secret token, never by a client-provided amount.
6. Backend creates a Stripe-hosted `Checkout Session` in HKD. Customer enters Visa/Mastercard or eligible card data **only at Stripe**; this site never processes or saves card numbers.
7. After payment, browser return is *informational only*. `POST /api/payments/stripe/webhook` marks `stripe_paid` only when Stripe's signed event and authoritative amount all match the stored quote.
8. Owner tracks status through `/admin`; refunds, unusual pricing, allergies and complaints remain human-handled.

## Production setup — merchant must perform privately

In the Stripe Dashboard, create or connect an eligible merchant account, complete identity/business verification, and enable card payments. Do not send API secrets in chats, GitHub files or screenshots.

Set **private** Render Environment values for a test phase:

```dotenv
PUBLIC_SITE_URL=https://lumenda-select-preview.onrender.com/
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_REPLACE_IN_RENDER_ONLY
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_IN_RENDER_ONLY
STRIPE_CHECKOUT_ENABLED=true
STRIPE_LIVE_APPROVED=false
```

Register an **HTTPS** Stripe webhook endpoint in the *test* account:

```
https://lumenda-select-preview.onrender.com/api/payments/stripe/webhook
```

Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Copy that endpoint's signing secret privately to `STRIPE_WEBHOOK_SECRET`. A Stripe CLI-forwarded secret and Dashboard endpoint secret are not interchangeable.

Test with Stripe's official **test-only** payment credentials (not real credit cards), confirm the new Checkout Session amount against the confirmed admin quote, and verify that the webhook marks the corresponding order as paid. Test cancellation, replayed notifications, wrong amount, invalid signatures and customer return without webhook. Finally independently reconcile events in the Stripe merchant Dashboard.

**Do not activate live mode** until the owner has explicitly approved the business account and checkout behaviour, real Stripe sandbox events have passed, taxes/import duties and refunds are documented, and webhook alerting/backups are ready.

For later **live** activation only: set `STRIPE_MODE=live`, a valid `sk_live_` secret, the *live* endpoint's `whsec_` secret, `STRIPE_CHECKOUT_ENABLED=true`, and `STRIPE_LIVE_APPROVED=true`. Rotate temporary/admin credentials separately. Never commit these values.

## Important limitations

- PayPal is currently a **merchant-generated link and human-verified payment flow**, not a connected PayPal Orders API or PayPal webhook. FPS/USDT remain payment preferences. The new automatic card integration is **Stripe only**.
- This implementation intentionally freezes a quote after a card checkout session exists. Resolve pricing changes, cancellation and refunds manually rather than silently changing the amount of an issued session.
- Cards may still be declined; no money is transferred just by opening or returning from a payment page.
- No tax engine, shipping quotation API, automated chargebacks, stock reservation or merchant-level reconciliation dashboard is included.
- The Render PostgreSQL service must be persistent and backed up. Keep all customer phone/order data in private storage; no customer data goes to public GitHub.
- A dedicated browser/mobility QA pass and a true Stripe test-mode end-to-end transaction should precede a public launch.

## Code and verification

- `lib/cart-pricing.mjs` and `lib/checkout-payments.mjs`: money calculations, official Stripe payload and signature validation.
- `server.js`: additive PostgreSQL schema, secure Checkout and webhook routes, locked verified quotes.
- `public/app.template.js`: storefront amount calculation; `public/admin.js`: strict quote editor; `public/order.js`: Stripe checkout button and verified receipt.
- `tests/cart-pricing.test.mjs`, `tests/checkout-payments.test.mjs`: unit tests.
- `integration/cart-stripe.integration.test.mjs`: DB + mock Stripe lifecycle.
- `integration/owner-v13.integration.test.mjs`, other regression suites: compatibility.

Use `npm run build` to rebuild the browser JS and run all smoke tests. For PostgreSQL integration tests, configure **disposable** `DATABASE_URL` first; never point test scripts at the live customer database.
