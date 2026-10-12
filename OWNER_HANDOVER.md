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
- Admin can read up to the latest 300 orders through `GET /api/orders`, update status, and export the loaded results as CSV. **This is NOT a complete PostgreSQL backup** if there are more than 300 orders.
- For a full database backup, use the database admin/pg_dump in an appropriately secured environment. Never put DB exports, backups or live `DATABASE_URL` in a public GitHub repository or chat.
- The original Railway order database, if still present, is a separate database and is NOT automatically migrated into Render.

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
