# LUMENDA SELECT — Render Free Keep-Warm

**Enabled:** GitHub Actions workflow `.github/workflows/keep-lumenda-awake.yml` is intended to run from the default `main` branch.

- Public target: `https://lumenda-select-preview.onrender.com/api/health`
- Schedule (UTC): `2,9,16,23,30,37,44,51,58 * * * *` — every ~7 minutes, with a 4-minute boundary interval.
- No customer info, API secrets, changes to orders, or payment requests are made.
- A request triggers/refreshes the free Render web service; successful checks return HTTP 200 and `ok:true`.
- The first verification run completed successfully using the free web service, with HTTP 200.
- Actions URL: https://github.com/chyiop88-eng/lumenda-select/actions/workflows/keep-lumenda-awake.yml

## Important limitations

This is **best-effort**, not a 24/7 uptime guarantee:
- GitHub scheduled jobs can be delayed/dropped during peak load, and public repos' scheduled jobs can auto-disable after 60 days of inactivity.
- Render Free web services can restart unexpectedly or sleep after 15 minutes without incoming traffic. Cold starts may take ~one minute.
- The shared monthly 750 Free instance-hour allotment applies to the workspace (per calendar month). Keeping more than one Free web service warm, or high usage, can exhaust the allotment and suspend services.
- The supported always-on solution is to upgrade **the Render web service compute plan** from Free to `0.5c-512mb` (legacy Starter), currently US$7/month, with billing approval. Upgrading the workspace subscription is not the same as changing the service compute plan.
- Never use `/api/orders` or any other mutation endpoint for keep-warm checks.

## Separate, urgent database risk

The **`lumenda-select-test-db` Render Postgres database** is currently on the Free plan and has a recorded expiry of **2026-11-11 00:57:04 UTC** (2026-11-11 07:57 Asia/Bangkok). Free Render Postgres databases expire 30 days after creation, with a grace period before deletion. A scheduled keep-warm request **does not** extend database lifetime or protect data.

Before database expiry, the owner should take a verified backup/migration and/or upgrade the database compute plan. No production customer records should be lost by treating a keep-warm ping as a backup. Any paid service upgrade requires the owner's confirmation.

## Disable or change interval

From GitHub, open **Actions → Keep LUMENDA SELECT Warm → ... → Disable workflow**, or remove/modify `.github/workflows/keep-lumenda-awake.yml` from `main`. The `workflow_dispatch` trigger permits a manual health check from the Actions UI.

References: https://render.com/docs/free and https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
