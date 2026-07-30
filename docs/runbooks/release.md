# SafeLaunch — Release Runbook

> Step-by-step procedure for cutting a SafeLaunch release. The
> automation lives in `.github/workflows/ci.yml`, `deploy-staging.yml`,
> and `deploy-production.yml`. This runbook is the human-readable spec;
> every command in the workflows should match a step below.

## 1 · Pre-flight (release captain, 1 h before)

1. **Confirm the green build.** The release commit is the latest `main`
   tip where `.github/workflows/ci.yml` finished green. Copy the commit
   SHA — it goes into the deployment audit and the production PR.
2. **Verify the ruleset / corpus version.** The `vn-mvp-v1` ruleset is
   frozen; any rubric change requires a fresh benchmark set + re-baseline.
3. **Open the release PR.** Use the release-checklist template (see
   `docs/releases/mvp-release-checklist.md`); paste the CI green URL.

## 2 · Staging (auto on merge to `main`)

`.github/workflows/deploy-staging.yml` triggers on every push to `main`
after CI passes. The deploy:

1. Applies forward-only D1 migrations to the staging database.
2. Deploys the API Worker to the staging environment.
3. Deploys the Web Worker (OpenNext) to the staging environment.
4. Seeds **only the reviewed fixture provisions** into staging (not the
   full production corpus).
5. Runs `node scripts/smoke.mjs --base-url "$STAGING_URL"`.
6. Runs the eval gate (`pnpm -C packages/ai test -- eval-runner`).
7. Runs the latency probe (`node scripts/check-latency.mjs --base-url
   "$STAGING_URL" --samples 25`).
8. Uploads a redacted report artifact to GitHub Actions.

**Stop conditions** (any one halts the release):

- Smoke exits non-zero (any endpoint failed or exceeded the latency
  budget).
- Eval gate fails (`citationValidity < 1.0`, `highRiskPrecision < 0.9`,
  or `unsupportedHighRisk > 0`).
- Latency probe P95 ≥ 60 000 ms.

If any stop condition fires, do **not** proceed to production. Either
revert the merge commit on `main` (the `rollback.md` runbook covers
this), or fix forward with a follow-up PR and re-run the staging deploy.

## 3 · Production (manual workflow_dispatch)

Production deploy is **never** automatic. A release captain triggers
`.github/workflows/deploy-production.yml` via the GitHub Actions UI
("Run workflow") and selects the green commit SHA from step 1. The
workflow:

1. **Re-runs CI** against the chosen commit. If CI fails, the deploy
   aborts.
2. **Exports a D1 snapshot** to `artifacts/db-snapshot/db.sql` and
   uploads it as a 90-day artifact. **This is your rollback anchor.**
3. **Applies forward-only D1 migrations** to the production database.
4. **Deploys the API Worker** to production.
5. **Deploys the Web Worker** (OpenNext) to production.
6. **Shifts traffic gradually** — 10 %, then 50 %, then 100 % with a
   60 s pause between each step. The Worker version is pinned by a
   percentage rollout, not a flip.
7. **Runs smoke** against `https://api.safelaunch.app`.
8. **Runs the eval gate** again to catch rubric regressions.
9. **Runs the latency probe** with 50 samples.
10. **Records the deployment audit** to
    `artifacts/deployment.json` — commit, ruleset, prompt version, model,
    corpus version, timestamp. This artifact lives for 365 days.

## 4 · Verification (release captain)

After the workflow reports green, manually verify:

- The marketing homepage at `https://safelaunch.app/<locale>/` for both
  `vi` and `en` — the form must accept a public URL and submit a scan.
- A scan on `https://example.com/` reaches a terminal state within
  the latency budget.
- A report URL is single-use — opening it twice does not show the
  payload the second time.
- The admin queue at `https://safelaunch.app/admin/legal/` (gated by
  Cloudflare Access) shows at least one pending document.

## 5 · Roll-forward vs. roll-back

- **Roll-forward** is preferred. The next deploy supersedes the
  previous version; no special "rollback" deploy is needed.
- **Roll-back** (Worker traffic to a prior version) lives in
  `docs/runbooks/rollback.md`. The procedure restores the previous
  Worker version, optionally disables new scans, and verifies report
  access.

## 6 · Audit retention

- **Worker audit logs** (CI + deploy runs) — 90 days (GitHub default
  for public repos).
- **D1 snapshot** (production pre-deploy export) — 90 days.
- **Deployment audit** (`deployment.json` artifact) — 365 days.
- **Report payloads** — 7 days (per `docs/privacy/data-inventory.md`).

## 7 · Change log

- `2026-07-30` — v1 runbook. First release of the SafeLaunch MVP.
