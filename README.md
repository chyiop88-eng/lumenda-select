# LUMENDA SELECT · Render full-stack source (v9)

This is a source project prepared for Render, adapted from the original Railway / Bun version. It is **not yet deployed to Render**.

## What it includes

- Six-market storefront: CN, HK, TW, MY, VN, TH; market-specific shipping fields and a separate language selector (Traditional Chinese, Simplified Chinese, English, Malay, Vietnamese, Thai)
- Two SK-II signature product enquiry cards (神仙水 230ml and 小燈泡 50ml), cart, customer and delivery data, payment *preferences* (not a checkout charge)
- Real order API, persisted into PostgreSQL once `DATABASE_URL` is set
- Admin sign-in at `/admin` (also `/admin.html`), protected order list and status updates, CSV export
- Two admin image upload slots: Facial Treatment Essence / 神仙水, GenOptics Aura Essence / 小燈泡. Uploaded JPG/PNG/WebP up to 4 MB are stored persistently in PostgreSQL `bytea` and served under `/media/fte` and `/media/aura` (with the high-quality default art as fallback)
- Preloaded 1122×1402 promotional WebP artwork (~330 KB each) from the user's previous website project

**Independent retailer:** LUMENDA SELECT is not affiliated with, endorsed by, or an authorized store of SK-II/P&G. Promotional artwork is AI-created retailer artwork, not official campaign photography.

## Shipping policy (HKD)

The seller-confirmed merchandise subtotal of **HK$4,000 or above** qualifies for free shipping. Below HK$4,000, shipping fees and any destination taxes or duties are assessed separately. Free shipping does not waive statutory taxes. Prices have not been published, so the website cannot determine eligibility automatically; each new order records the threshold and remains `pending_quote` until a seller confirms the quotation. Other six-market currency displays are informational and do not change the HKD threshold.

## Run

Node.js 20+, PostgreSQL 14+.

1. `npm install`
2. `npm run build` (generates `public/app.js` from `public/app.template.js` and the markets/products configuration)
3. Set private environment variables (see `.env.example`): `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (minimum 16 characters), `ADMIN_SESSION_SECRET` (minimum 32 characters). Never commit real values.
4. `npm start` (binds to `PORT`, default 3000)

The application creates `lumenda_orders` and `lumenda_media` tables on first use. Back up your PostgreSQL data. Do not use an expiring trial database for real customer orders.

## Deploy on Render

Render's web-service creation connector requires a Git repository; a ZIP cannot be sent directly to it. After pushing this project to a repository connected to Render, create a **Web Service** with:

- Runtime: Node
- Build Command: `npm install --omit=dev && npm run build`
- Start Command: `npm start`
- Region: Singapore (or nearest customers)
- Health check: `/api/health`
- Environment variables: `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`

For durable live orders use a **persistent** PostgreSQL plan and connect its *internal* database URL. Render's temporary/free PostgreSQL databases have a limited lifespan. Plan and approve paid resources before creating them. The app stores uploads in PostgreSQL instead of ephemeral Render service disk, so a redeploy does not erase ads.

## Endpoints and limitations

- `/` storefront; `/admin` admin login
- `/api/health` reflects configuration state (`ordersEnabled:false` if DB URL absent)
- `/api/orders` POST saves an order, GET admin-only; `/api/orders/<id>` PATCH admin-only
- `/api/admin/login`, `/api/admin/logout`, `/api/admin/session`
- `/api/admin/media/fte`, `/api/admin/media/aura` POST authenticated uploads
- `/media/fte`, `/media/aura` GET public images

No automatic inventory or shipping quotes; no live payment processor or merchant account; confirmation remains manual. **Original Railway PostgreSQL order records are not automatically migrated** and are not deleted by this package. Migrate/copy them separately only after assessing the existing database.

Do not reuse the admin password disclosed in any earlier chat; generate a new strong password. The app uses HttpOnly Secure SameSite=Strict signed sessions, 8-hour max age, basic login throttling, a size-limited image upload, and simple order rate limiting. For a large real store, add managed bot protection and stronger audit logging.

## Tests

`npm run test:smoke` (requires a local database to test storage and orders end to end; the included basic smoke test intentionally runs without DB and checks that saving orders fails safely).

Before collecting live orders, verify: public store on phone/desktop; six markets and address fields; admin login and access controls; fresh-image upload and persistent image after deploy; test order stored in Postgres; order status update and CSV download; backups; the merchant details and data/privacy policy.
