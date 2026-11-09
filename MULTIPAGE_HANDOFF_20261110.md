# LUMENDA SELECT — true multi-page SK-II storefront

**Site:** https://lumenda-select-preview.onrender.com/

## Public front-end pages

| Page | URL | Purpose |
|---|---|---|
| Home | `/` | Brand introduction and featured products; **no checkout form** |
| Catalog | `/products` | All three SKUs, individual cards and CNY displayed prices |
| Facial Treatment Essence 230ml | `/product/fte230` | Product detail, CNY ¥750, add to cart |
| Facial Treatment Essence 330ml | `/product/fte330` | Product detail, CNY ¥990, add to cart |
| GenOptics Aura Essence 50ml | `/product/genoptics50` | Product detail, seller quote required |
| Shopping and delivery guide | `/about` | Purchase process, shipping threshold and payment disclosure |
| Cart and order enquiry | `/checkout` | Existing six-market destination selection, 6-language cart/order form (private/noindex) |
| Private customer receipt | `/order#<receiptToken>` | Individual order status; token must be kept private |
| Owner dashboard | `/admin` | Order CRM, media and owner-only functions, reserved Muse UI |

The browser stores **only product SKU quantities, selected language, destination code and permitted referral/channel labels** in its tab session to allow crossing from product detail to checkout. The order remains server-validated and private; no customer name/phone/address is stored in a browser shopping cart. Cart values from the browser are never trusted to set final payment amounts.

The homepage and catalog do not display automatic AI customer support; the owner dashboard has a **Muse — future integration** field labelled **not connected** and does not communicate with Muse.

## Handoff scope

- Front end and owner admin UI, **not** managed AI support, bot replies, marketing, merchant account onboarding or live payment gateway.
- Keep seller-authorized product descriptions and real stock photos separate from the existing *AI concept* artworks. The existing campaign artwork is explicitly marked as concept art and not actual merchandise photography.
- 230ml CNY ¥750 and 330ml CNY ¥990 are **public list prices**, not finalized HKD charges. Shipping, taxes and HKD amount require seller confirmation; no Live PayPal collection is enabled.
- The owner's video links remain displayable on the home page if individually enabled in the admin dashboard.

## Test before giving to the client

1. Open `/`, then `/products`, then each `/product/...` path; verify desktop and mobile layout.
2. Add an item on a product page: must arrive at `/checkout` with the same SKU, count and CNY list amount.
3. Change quantity or remove item on `/checkout`, visit `/products`, return: cart should persist within that browser tab.
4. Change language/destination and ensure dynamic address fields match the chosen market; referral `?ref=...` should persist only for permitted valid codes.
5. Submit only a **test** order with consent after the database is available; confirm the customer gets an order number/private receipt, and the owner-only admin can see the correct data.
6. Verify `/admin` requires login and displays **Muse: not connected**. Never store credentials or customer data in publicly shared Notion pages.
7. Double-check `/api/health` shows `paypalCheckoutEnabled=false` and `paymentsLive=false` before handoff.

## Critical data hosting issue

Render Free PostgreSQL database `lumenda-select-test-db` has a recorded expiration of **2026-11-11 00:57:04 UTC**. The 2026-11-10 Notion source-code ZIP **does not include a verified full PostgreSQL data export**. **Do not treat source code backups as order/customer data backups.** Export/restore privately and migrate or upgrade DB before expiry. Do not distribute real customer records through a public Notion link.

## Deployment mechanics

- Repository: https://github.com/chyiop88-eng/lumenda-select
- Static site routing implemented in `server.js` via an allowlisted map of URL paths to `public/*.html`.
- Build generator: `scripts/build_frontend.mjs`; `npm run build` includes source checks and smoke tests.
- All public pages share `public/site-pages.js` and versioned `styles.css`, with seller-facing order logic from `public/app.template.js` loaded only on `/checkout`.
- Render connected to GitHub `main`; check **actual Render deploy SHA** and external HTTP status before claiming live deployment.

No new database tables, purchases, customer support integrations or paid platform plans are required by this front-end UI change.
