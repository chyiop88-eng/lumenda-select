# LUMENDA SELECT: PayPal merchant checkout deployment

Status: merchant checkout has been implemented and exercised against a LOCAL MOCK PayPal API and an isolated PostgreSQL CI database. No real PayPal merchant API credentials have been connected, no real money has moved, and this branch is NOT yet deployed to the live Render site.

## Payment priority
- PayPal: official Orders v2 API, seller-confirmed HKD order total, hosted buyer approval, authenticated capture and PayPal API-verified webhook. Only a COMPLETED capture of the exact amount matching the saved quote can mark the order paypal_paid.
- FPS: owner supplies a real FPS bank identifier/QR/instructions privately after seller quote; checks actual bank credit and saves the transaction reference. No FPS bank API has been connected.
- USDT: owner supplies correct blockchain network, receive address, exact settlement amount and exchange/expiry terms. Confirm transfer to the correct wallet on the correct network before the admin records chain and transaction hash. Never share wallet seed phrases or private keys. No automatic blockchain watcher or exchange-rate feed is connected.
- Stripe: unnecessary; disabled by default. Existing optional Stripe code remains isolated behind environment switches.

All merchandise prices, delivery and tax charges are server-calculated and seller-confirmed. SK-II Facial Treatment Essence 230 ml is CNY ¥750 and 330 ml is CNY ¥990. The server stores original RMB values and the seller must approve the CNY→HKD exchange rate used for the final checkout price. Original orders maintain their historical price snapshots. GenOptics Aura Essence 50 ml needs an approved unit price. HK$4,000 of confirmed merchandise qualifies for free shipping (not tax exemption). Display USD conversion is NEVER the amount charged to PayPal.

## Required one-time merchant actions

1. Confirm a verified PayPal Business merchant account which can receive payments in Hong Kong dollars (HKD). If currently a personal account, check merchant upgrade eligibility. Confirm payment receiving preferences, merchant/foreign currency restrictions, applicable fees and business compliance.
2. In https://developer.paypal.com/dashboard/applications/sandbox create a Sandbox REST API app. Obtain Client ID and Secret privately. Do not paste private secrets into chat or a public repository.
3. Configure a PayPal Sandbox webhook for:
   https://lumenda-select-preview.onrender.com/api/payments/paypal/webhook
   Subscribe to PAYMENT.CAPTURE.COMPLETED. Copy the webhook's registered Webhook ID, which differs from the app Client ID.
4. In private Render service Environment at https://dashboard.render.com/web/srv-db62vfdckfvc73bupfcg merge these environment variables (never replace unrelated values):
   PUBLIC_SITE_URL = https://lumenda-select-preview.onrender.com/
   PAYPAL_MODE = sandbox
   PAYPAL_CLIENT_ID = your_sandbox_client_id
   PAYPAL_CLIENT_SECRET = your_sandbox_secret
   PAYPAL_WEBHOOK_ID = your_registered_sandbox_webhook_id
   PAYPAL_CHECKOUT_ENABLED = true
   PAYPAL_LIVE_APPROVED = false
   STRIPE_CHECKOUT_ENABLED = false
5. Test a genuine Sandbox purchase on a disposable staging database (NOT with a live customer's personal details), including cart, quote, PayPal approval, server-side capture and genuine signed webhook. Check the PayPal merchant dashboard and matching captured order amount. PayPal simulated webhook events may use a simulator-specific ID and may not pass verification against the registered webhook ID.
6. Test payment refusal, cancellation, underpayment, duplicate notifications, repeated button presses, stale orders and quote locking. Verify data backups and merchant account permissions before live activation.
7. For LIVE merchant operation, separately create a Live REST API app and register a Live webhook for the same HTTPS endpoint. In private Render Environment set PAYPAL_MODE = live, the LIVE Client ID/Secret/Webhook ID, PAYPAL_LIVE_APPROVED = true, and PAYPAL_CHECKOUT_ENABLED = true. Live and Sandbox credentials and webhook IDs are NOT interchangeable. Do not activate until the account owner explicitly approves genuine payment acceptance and all real-sandbox tests pass.

## Verified workflow
- Customer selects PayPal and sends order inquiry; gets a secret receipt link.
- Admin sets itemized HKD quote with correct quantity, delivery fees, applicable taxes and stock approval.
- On receipt page PayPal button creates Order v2 using OAuth and the backend calculated amount, then sends buyer to PayPal's official host.
- Buyer approves. Browser return triggers server-side POST to capture; alternatively a genuine PayPal webhook can notify a capture completed.
- Server verifies the exact order ID, purchase reference, currency HKD, capture ID, capture status COMPLETED and capture amount against the stored quote using authenticated PayPal API responses.
- Only then the admin order status becomes paypal_paid. A browser redirect, customer screenshot, unverified event or forged amount cannot mark paid.
- No payment account password, credit card, banking login or seed phrase is stored by the website.

## Remaining operational limits
- FPS and USDT are owner-reviewed manual transfers only; the site does not connect directly to FPS bank rails or blockchain APIs.
- Customer credit card funding options within PayPal depend on actual merchant/buyer regions and PayPal eligibility.
- PayPal refunds, disputes, account restrictions, shipment tracking, inventory reservations, duties and FX conversion need separate operational controls.
- Do not publish customer records or backups in the GitHub repository. Rotate any earlier exposed admin password and session secret.
- Keep this PR isolated until PayPal Sandbox credentials are configured and an end-to-end merchant test is verified. The Render site auto-deploys from main only after a merge.

## Relevant code
lib/paypal-payments.mjs, lib/paypal-service.mjs, lib/checkout-payments.mjs, server.js, public/order.js, public/admin.js.
Unit tests: tests/paypal-payments.test.mjs.
Integration tests: integration/paypal-checkout.integration.test.mjs.
CI: .github/workflows/cart-payments-ci.yml.
