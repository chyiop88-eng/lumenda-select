> **v14 feature-branch notice (2026-10-12):** A server-verified cart, locked itemized quotes and Stripe-hosted card checkout with signed webhooks have been implemented in PR #1, NOT merged/deployed. The existing live site is still v13 enquiry-only until this branch is approved and merchant credentials configured. See [PAYPAL_LIVE_SETUP.md](PAYPAL_LIVE_SETUP.md) for merchant activation and [CHECKOUT_DEPLOYMENT.md](CHECKOUT_DEPLOYMENT.md) for earlier Stripe (unused) notes. Official PayPal Orders v2 API with server-side capture and verified webhook has been added in the feature branch, gated OFF until merchant credentials are configured. FPS/USDT are owner-verified; manual PayPal payment links remain available as a separate workflow.\n\n# LUMENDA SELECT · v13 (two SK-II heroes + customer CRM and safe checkout handoff)

This live Node.js/PostgreSQL website is deployed at https://lumenda-select-preview.onrender.com. Source is managed on GitHub and automatically built on Render. The app is an enquiry storefront, not an online card checkout.

## What it includes

- Six-market storefront: CN, HK, TW, MY, VN, TH; market-specific shipping fields and a separate language selector (Traditional Chinese, Simplified Chinese, English, Malay, Vietnamese, Thai)
- Three orderable variants (Facial Treatment Essence 230ml CNY ¥750, 330ml CNY ¥990, and GenOptics 50ml quote-only), cart and private order data with seller-confirmed HKD settlement
- Real order API, persisted into PostgreSQL once `DATABASE_URL` is set
- Admin sign-in at `/admin` (also `/admin.html`), protected order list and status updates, CSV export
- Two admin image upload slots: Facial Treatment Essence / 神仙水, GenOptics Aura Essence / 小燈泡. Uploaded JPG/PNG/WebP up to 4 MB are stored persistently in PostgreSQL `bytea` and served under `/media/fte` and `/media/aura` (with the high-quality default art as fallback)
- Preloaded 1122×1402 promotional WebP artwork from the user's previous website project
- **Three optional video/animated imagery areas:** a brand cinema area after the home hero, and a motion slot under each of the two SK-II campaign cards. Blank slots are completely hidden, so existing layouts remain compact.
- **Rose Aura motion effects:** gently moving rose petals, shimmering highlights and Ken Burns-style movement of the two uploaded still promotional artworks. Respect browser reduced-motion preferences.
- Owner-only **影片／動態圖片管理** editor, backed by PostgreSQL URLs with per-slot enable/disable. External MP4/WebM, YouTube, Vimeo, GIF, animated WebP and APNG are supported. Actual large video binaries are *not* uploaded to Render.

**Independent retailer:** LUMENDA SELECT is not affiliated with, endorsed by, or an authorized store of SK-II/P&G. Promotional artwork is AI-created retailer artwork, not official campaign photography.

## Shipping policy (HKD)

The seller-confirmed merchandise subtotal of **HK$4,000 or above** qualifies for free shipping. Below HK$4,000, shipping fees and any destination taxes or duties are assessed separately. Free shipping does not waive statutory taxes. Prices have not been published, so the website cannot determine eligibility automatically; each new order records the threshold and remains `pending_quote` until a seller confirms the quotation. Other six-market currency displays are informational and do not change the HKD threshold.

## Run

Node.js 20+, PostgreSQL 14+.

1. `npm install`
2. `npm run build` (generates `public/app.js` from `public/app.template.js` and the markets/products configuration)
3. Set private environment variables (see `.env.example`): `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (minimum 16 characters), `ADMIN_SESSION_SECRET` (minimum 32 characters). Never commit real values.
4. `npm start` (binds to `PORT`, default 3000)

The application creates `lumenda_orders`, `lumenda_media`, `lumenda_agents`, and `lumenda_showcase_media` tables on first use. Back up your PostgreSQL data. Do not use an expiring trial database for real customer orders.

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
- `/api/showcase` GET public, enabled media slots only
- `/api/admin/showcase` GET authenticated editor state, `/api/admin/showcase/{brand|fte|aura}` POST authenticated URL and publish settings

No automatic inventory or shipping quotes; no live payment processor or merchant account; confirmation remains manual. **Original Railway PostgreSQL order records are not automatically migrated** and are not deleted by this package. Migrate/copy them separately only after assessing the existing database.

Do not reuse the admin password disclosed in any earlier chat; generate a new strong password. The app uses HttpOnly Secure SameSite=Strict signed sessions, 8-hour max age, basic login throttling, a size-limited image upload, and simple order rate limiting. For a large real store, add managed bot protection and stronger audit logging.


## 🎬 How to add videos or motion images from the owner dashboard

1. Finish your video and host it at YouTube or Vimeo, or upload an MP4/WebM to a video CDN/object-storage service that offers a public **HTTPS direct-file URL**.
2. Log in at https://lumenda-select-preview.onrender.com/admin and open **影片／動態圖片管理**.
3. Choose one of three positions: homepage brand feature, Facial Treatment Essence, or GenOptics Aura Essence.
4. Select **video** or **motion image**; paste a source URL. For videos, accepted formats are YouTube/Vimeo pages and direct HTTPS MP4/WebM. For motion images use direct HTTPS GIF, animated WebP or APNG URLs. Animated-image files must truly contain multiple frames; the extension alone does not turn a still picture into an animation.
5. Tick the visibility checkbox and save the slot. Reload the storefront. Unpublished or empty slots render nothing and create no reserved whitespace. To temporarily hide the media, untick the checkbox and save; to delete the source, clear the URL and save it as disabled.
6. Direct MP4/WebM videos play muted while visible (with controls). YouTube and Vimeo open only when a visitor presses **Play video**. Visitors preferring reduced motion do not receive automatic playback. If an external source fails to load, the video will be hidden.

**No additional hosting fee was initiated.** Large videos are intentionally kept outside the expiring/free Render instance; only sanitized links and visibility preferences are stored in PostgreSQL. Avoid expiring/signed URLs or links that require provider authentication, and respect video/music licensing. This system doesn't accept local video-file uploads from the admin dashboard.

## Tests

`npm run test:smoke` (requires a local database to test storage and orders end to end; the included basic smoke test intentionally runs without DB and checks that saving orders fails safely).

Before collecting live orders, verify: public store on phone/desktop; six markets and address fields; admin login and access controls; fresh-image upload and persistent image after deploy; test order stored in Postgres; order status update and CSV download; backups; the merchant details and data/privacy policy.

## v13 new functionality

- FTE230 seller list price **CNY ¥750** and FTE330 **CNY ¥990**. These are original-currency list prices, not payable HKD amounts. Admin must confirm the CNY-to-HKD rate before calculating an HKD PayPal or FPS settlement quote. Legacy submitted orders keep their original HKD pricing snapshots. GenOptics remains quote-only.
- Owner-only phone lookup from submitted orders in `/admin`, no scraping of abandoned form inputs or unauthorized bulk marketing.
- Private customer receipt link on successful order enquiry, with order status, quotation, and third-party hosted payment button only after a seller supplies one.
- Standalone rule-based customer-service bot for initial order questions, with optional disabled-by-default xAI/Grok API if owner separately supplies an xAI API key and approves costs.
- Owner manually enters HKD subtotal and jurisdiction-specific taxes, with free shipping for confirmed merchandise subtotal >= HK$4,000. Optional official Stripe/PayPal hosted payment URL. No live checkout, automatic payment verification, card storage or webhook; `paymentsLive` remains false.
- For deployment and full safety/operational details, read [`OWNER_HANDOVER.md`](OWNER_HANDOVER.md).
