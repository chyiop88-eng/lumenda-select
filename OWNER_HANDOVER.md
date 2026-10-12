# LUMENDA SELECT — Owner handover / 站長交接資料
Updated 2026-10-12. No passwords, database URLs, session signing keys or customer records are included.

## Important access
- Website: https://lumenda-select-preview.onrender.com/
- Owner/admin login: https://lumenda-select-preview.onrender.com/admin
- Source repository: https://github.com/chyiop88-eng/lumenda-select
- Full current source ZIP: https://github.com/chyiop88-eng/lumenda-select/archive/refs/heads/main.zip
- Render app: https://dashboard.render.com/web/srv-db62vfdckfvc73bupfcg
- Render PostgreSQL: https://dashboard.render.com/d/dpg-db630o3bc2fs73akff50-a
- Render workspace: My Workspace; region: Singapore
- GitHub repository visibility: PUBLIC. Do not commit secrets or private order data.


## v13 — Prices, contact memory, customer bot and hosted payment links
- **神仙水 Facial Treatment Essence 230ml** latest seller price: **HK$899** per bottle, **approximately US$114.55**, using 2026-10-12 reference rate 1 HKD ≈ 0.127422 USD. Previous CNY ¥800 reference was superseded for storefront display. This is an indicative conversion, excluding freight and taxes, not a live daily FX guarantee.
- **小燈泡 GenOptics Aura Essence 50ml**: price still requires seller confirmation; never invent one.
- **Free shipping**: only if seller-confirmed merchandise subtotal reaches **HK$4,000**, regardless of the displayed USD reference. Destination taxes are separately entered from the real jurisdiction; free shipping does not waive tax.
- **Owner phone memory** in `/admin`: `GET /api/admin/contacts` returns a searchable, paginated address book of phone numbers from **submitted, consented orders only** (deduplicated by international phone). Never store abandoned form keystrokes; do not reuse for unsolicited campaigns without separate permission. Deleting an order also affects derived contact history.
- **Instant order bot acknowledgement**: after submitting an enquiry, customer receives an order ID and secret URL `/order#<token>`. Token is generated randomly, a SHA-256 digest is stored with the order, and customers can view only non-personal data (order ID, two product SKUs, quote and payment status). Preserve the private link; treat it as a bearer credential.
- **Website customer FAQ bot**: `POST /api/bot/reply` accepts short customer questions. Safe rule-based responder is ON by default, with no stored chat transcript. The owner may separately enable xAI/Grok via the **private** Render environment variables `XAI_API_KEY`, `XAI_BOT_ENABLED=true`, and optional `XAI_MODEL` only after creating/funding a permitted xAI API account. A Grok app or Grok Bot subscription is **not automatically an xAI API key**. API availability, pricing and permissions must be verified with the provider.
- **HKD quotation**: owner-only `POST /api/admin/orders/{id}/quote` stores actual merchandise subtotal, shipping, taxes, note and optional merchant-issued Stripe/PayPal HTTPS payment URL. Shipping becomes HK$0 when subtotal >= HK$4,000; taxes are never waived automatically. Quote is intentionally NOT automatically computed from the indicative USD reference because tax, stock, and shipping need seller confirmation.
- **Third-party hosted checkout**: owner supplies a real merchant-generated Stripe or PayPal payment link, shown only on the customer's private order status page. There is **no merchant connection, payment initiation API, card capture or payment webhook yet**. `paymentsLive:false` remains correct while merchant credentials are not connected; NEVER call a payment completed merely because the customer opens/returns from a link.
- **Owner manual transaction verification**: `POST /api/admin/orders/{id}/payment` requires owner auth, explicit confirmation and a real transaction reference from the merchant dashboard. This is bookkeeping, **not** processor-verified automation. No refund automation or money movement is enabled.
- These features add nullable order columns. They **do not drop orders or overwrite original customer JSON**. New video/referral tables are unaffected.

### Required next operational tasks (before live paid orders)
1. Rotate the temporary admin password and session secret privately; the old password has appeared in conversation history.
2. Renew or replace the temporary Render PostgreSQL (previous expiry displayed as 2026-11-11), preserve backups in a secure account. The current publicly downloadable GitHub source ZIP contains no customer records and is not a DB backup.
3. Obtain a verified Stripe/PayPal merchant account and configure legitimate hosted checkout links, then test real webhooks/processor verification in the provider's sandbox before enabling fully automatic payment recognition.
4. If choosing Grok, configure your own xAI API account and set keys only via Render Environment. Explicitly approve usage/billing limits; do not place tokens into GitHub.
5. Review data retention/consent, cross-border shipping/import-tax compliance and earlier security audit findings. No customer telephone may be ingested from unsubmitted form fields.


## Owner identity and configuration
- Admin username (configuration): `lumenda_owner`.
- Admin password: NOT included. Change it privately in Render's Environment panel; an earlier temporary value was shared in a chat and needs rotation.
- `ADMIN_SESSION_SECRET`: private; rotate when changing admin password to invalidate existing signed sessions.
- App environment variable names: `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `PORT`.
- Backend: Node.js + `postgres` driver; source entrypoint `server.js`.
- Build: `npm install --omit=dev && npm run build`; start: `npm start`.
- Two SK-II signature products: `FTE230` Facial Treatment Essence 230 ml and `GENOPTICS50` GenOptics Aura Essence 50 ml.
- Markets: HK, CN, TW, MY, VN, TH with localized forms and language options.
- Delivery policy: seller-confirmed merchandise subtotal >= HK$4,000 qualifies for free shipping; below HK$4,000 freight and applicable taxes quoted separately. Free shipping does not mean free tax.
- Order mode: **enquiry only**, not automated payment. No actual price list or commission schedule configured.
- Branding: LUMENDA SELECT is an independent retailer, not officially affiliated with SK-II or P&G. AI advertising art must not be represented as actual product photographs or official campaigns.

## What is in the backend / database
- `lumenda_orders`: order ID, timestamp, status, destination, customer and shipment info (JSONB), products (JSONB), note, `referral_code` (nullable).
- `lumenda_media`: owner-uploaded promotional assets for the two products; served at `/media/fte` and `/media/aura`.
- `lumenda_agents`: per-agent sharing codes, display names, role (`agent` or `referrer`), optional superior `parent_code`, enable/disable status, creation time.
- `lumenda_showcase_media`: owner-managed, enable/disable links for the three optional brand and product video/motion-image slots.
- Admin can read up to the latest 300 orders through `GET /api/orders`, update status, and export the loaded results as CSV. **This is NOT a complete PostgreSQL backup** if there are more than 300 orders.
- For a full database backup, use the database admin/pg_dump in an appropriately secured environment. Never put DB exports, backups or live `DATABASE_URL` in a public GitHub repository or chat.
- The original Railway order database, if still present, is a separate database and is NOT automatically migrated into Render.


## Video and animated imagery controls (v12)
- Three optional cinema slots: **brand** after the homepage hero; **fte** below Facial Treatment Essence card; **aura** below GenOptics Aura Essence card.
- Each slot supports exactly one enabled media URL at a time (video or animated image); setting/unsetting a slot never removes the original two product images.
- Config stored in `lumenda_showcase_media`: `slot`, `kind` (`video` or `motion`), `provider`, `url`, `enabled`, and `updated_at`.
- Admin management: `/admin` → **影片／動態圖片管理** → select slot and media type → paste HTTPS URL → tick enable → Save. Changes take effect without redeploying.
- Accepted links: YouTube, Vimeo, direct HTTPS .mp4/.webm; or direct HTTPS animated .gif/.webp/.apng.
- Video files themselves must be hosted separately. Render stores links but not video binaries; do not upload large files to ephemeral Render disk. Public videos may create bandwidth/hosting charges at your chosen external provider.
- No media configured: slot remains hidden without whitespace. Pages still use existing Rose Aura cinematic CSS motion (drifting petals, soft light, subtle portrait breathing); reduce-motion system settings disable animated motion.
- Public `GET /api/showcase` shows enabled slots only. Owner-only `GET /api/admin/showcase` and `POST /api/admin/showcase/{slot}` manage configuration.
- In this version, a slot is either an animated image or video. Unlimited galleries, self-hosted video uploads, transcoding, progress bars, analytics and pay-per-video features have not been implemented.

## Creating agent/referrer sharing links
1. Log in as owner at `/admin`.
2. Open **代理／介紹人邀請連結**.
3. Enter a display name; choose **下線代理** or **介紹人**.
4. Optionally select an existing active superior agent; click **建立專屬邀請連結**.
5. Copy the generated URL. Pattern: `https://lumenda-select-preview.onrender.com/?ref=AG... ` or `?ref=RF...`.
6. Customers arriving via that link can browse the same two products and submit the normal order form. The validated active code is recorded when an order is created.
7. Admin order details, agent order counts and exported CSV include attribution. Disable a link to stop new attribution without deleting earlier orders.

**Restrictions:** These are SHOP-SHARING links, not admin or subagent login links. Agents cannot see order/customer records. They do not automatically earn commissions. Referral attribution is based on a browser tab's session and may be reset if the user changes devices or tabs. No verified commission, hierarchy payout or automatic financial settlement is implemented.

## Safety/operational notices
- Render free PostgreSQL expiry previously reported: **2026-11-11**. Check the database console; arrange a retained, backed-up database before taking production customer orders.
- Prior isolated security audits found lack of durable session revocation at logout, permissive magic-byte image validation and in-memory login throttling based on forwarded IP headers. The referral feature does not, by itself, repair these items.
- No paid service, card checkout, direct bank settlement, customer-data export, or access expansion should be performed without a separate explicit decision.
- The project source and UI remain available to anyone while the GitHub repository is public. Store only non-secret code there.

## Main source files
- `server.js`: server, order/referral/admin/media APIs, PostgreSQL schema auto-creation
- `public/index.html`: Rose Aura storefront and order enquiry form
- `public/app.template.js`: bilingual/multimarket storefront runtime, browser-tab referral capture
- `public/admin.html` and `public/admin.js`: owner dashboard, order CSV and agent invite management
- `public/styles.css`: responsive visual effects and admin layout
- `public/i18n.js`: supported languages
- `config/products.json`, `config/markets.json`: product/market configuration
- `tests/http.test.mjs`: existing smoke test
- `integration/referrals.integration.test.mjs`: disposable-database referral test

## Verifying after deployment
- `GET /api/health` returns app status with `agentInvitesEnabled: true` once environment has `DATABASE_URL`.
- Admin Agent list loads without errors.
- New agent link copies and opens the storefront with a referral notice.
- Submit a test enquiry ONLY in a disposable staging database when testing attribution automatically. Production order data must not be polluted with simulated customers.
