# LUMENDA SELECT — Authorized Round 2 Trojan/Backdoor Simulation
**Date:** 2026-10-12 (ICT)  
**Live app:** https://lumenda-select-preview.onrender.com  
**Production commit audited:** `18cc615f3e3a7b20c79a8a0d152fdf2514defccc`  
**Isolated branch:** `security-audit-round2-2026-10-12`  
**Evidence:** https://github.com/chyiop88-eng/lumenda-select/actions/runs/38199094468

## Executive result
- 11/11 authorized, **unauthenticated, low-impact** production checks passed.
- 10/10 isolated full-stack test cases executed successfully with a temporary PostgreSQL database and test-only administrator credentials; **three security findings** were reproduced.
- Original 5 smoke tests also passed.
- **No successful unauthorized admin access, remote code execution, or Trojan execution demonstrated.**
- No real malware, destructive payload, password guessing campaign, customer-data access or authenticated production image upload was performed.
- All simulated "Trojan" content was non-executable canary data stored in an ephemeral CI database only.

## Findings
### R2-01 — Logout does not revoke already issued sessions
**Priority:** High to remediate; impact depends on prior cookie theft.
**Evidence:** In isolated environment, obtained a test-only admin cookie, logged out, then reused the captured cookie against `GET /api/admin/session` and received HTTP 200.
**Cause:** HMAC-signed stateless session token is accepted until expiry. `POST /api/admin/logout` only clears the browser cookie; no server-side revocation is performed. See `server.js` functions `adminToken`, `validAdmin`, logout route.
**Remediation:** Use server-side session records in PostgreSQL/Key Value with a random opaque cookie token hashed at rest; revoke on logout and credential rotation. Consider shorter TTL and rotation.

### R2-02 — Malformed PNG can pass upload validation
**Priority:** Medium / defense-in-depth, not proven code execution.
**Evidence:** An *authenticated local test admin* uploaded inert canary bytes starting with a PNG signature, followed by non-image content. The server returned HTTP 200 and stored it; GET returned `Content-Type: image/png` plus `X-Content-Type-Options: nosniff`.
**Cause:** `server.js` `validImageBytes` verifies image magic bytes, not successful image decoding, dimensions or image structure.
**Important limit:** Admin permission was required. This does **not** demonstrate executable upload, a Trojan running, or RCE.
**Remediation:** Decode with a maintained image library using pixel/dimension/time/memory limits, then re-encode to a canonical image format; strip metadata; optionally malware-scan and quarantine media.

### R2-03 — Application-level login rate limiter trusts proxy IP fields
**Priority:** Medium; deployment-specific exploitability unconfirmed.
**Evidence:** Local test sent eight failed requests from an inert test IP in `X-Forwarded-For`, ninth returned 429, and another request with an alternate header IP returned 401 (counter reset).
**Production contrast:** Previous live tests showed changes to `X-Forwarded-For` did **not** bypass HTTP 429; use of `CF-Connecting-IP` was refused by edge (HTTP 403). The live deployment has **not** been successfully bypassed.
**Cause:** `adminLoginLimited` keys its process-local state directly from forwarded client-supplied IP headers.
**Remediation:** Verify trusted proxy chains at ingress; never trust arbitrary client-supplied IP headers; implement shared Redis/Key Value or platform/WAF rate limiting per authenticated request and account.

### R2-04 — Upload body is fully buffered before size rejection
**Priority:** Medium availability hardening, code inspection + local size test.
**Evidence:** 5 MiB upload rejected with 400 in isolated environment; code reads `await req.arrayBuffer()` before enforcing 4 MiB maximum. No production DoS test performed.
**Remediation:** Enforce body size at ingress and while streaming with early abort; set request timeouts and bounded concurrency. Cap decompressed image pixels separately.

## Verified production protections (11/11)
- Health endpoint returned HTTP 200 and reported database enabled.
- Unauthenticated order listing and forged admin cookie were denied (HTTP 401).
- Unauthorized Trojan-like byte upload and PNG-header upload requests were denied (HTTP 401).
- Unauthorized order status PATCH was denied (HTTP 401).
- Invalid empty order payload was rejected without creating an order (HTTP 400).
- Direct access to `/server.js` and `/.env` returned HTTP 404.
- Public campaign media used an image MIME and `nosniff`.
- Homepage returned anti-framing CSP and X-Frame-Options.
These tests used no real login, no true executable, no live media write, no legitimate order creation and no customer-record retrieval.

## Follow-up checklist
1. Rotate the administrator password previously disclosed in a conversation; rotate the HMAC session secret to invalidate existing tokens.
2. Patch session revocation, upload image decoding/reencoding, trusted proxy rate limits and early request body size checks.
3. Add security regression tests to the deployment pipeline.
4. Deploy repairs via review/approved production branch, and retest the specific fixes.
5. Arrange a separate sustained, authorized assessment in a **staging** environment if seeking to test authenticated attacks, scanners, image parsers or denial-of-service safely.
6. Replace the temporary expiring Render PostgreSQL before accepting long-term customer orders.

**Scope note:** A clean test is not a guarantee that the site is free of vulnerabilities or malware. No evidence of a hidden backdoor was observed in the reviewed Node source or these probes, but no exhaustive dependency or host forensics was performed. Only the isolated audit branch was modified.
