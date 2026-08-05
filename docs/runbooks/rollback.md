# SafeLaunch — Rollback Runbook

> Step-by-step procedure for rolling back a SafeLaunch production
> deployment. The goal is to restore the previous Worker version
> first, keep data integrity intact, and preserve the audit trail.
> Practice this in staging before you ever need it in production.

## 1 · When to roll back

Roll back when **any** of the following is true after a production
deploy:

- The eval gate fails on the live URL.
- The smoke script reports a failure on a critical endpoint.
- The D1 migrations introduced a schema that breaks report generation.
- The new Worker version is causing 5xx rates > 1 % over a 5-minute
  window.

If the failure is **only** in the Web Worker (and the API Worker is
fine), do a Worker-level rollback (Section 3) without touching D1.

## 2 · Order of operations

Always restore in this order — never the reverse:

1. **Worker traffic** to the previous version (instant).
2. **New-scan creation** disabled (if data compatibility uncertain).
3. **D1** only if a migration rollback is required (rare, last resort).
4. **Verify** report access + admin review still work.
5. **Preserve** audit evidence.

Reversing this order risks a window where new scans write to a schema
the old Worker can't read.

## 3 · Roll back the Worker (most common)

Cloudflare Workers retains a history of every published version. The
fastest rollback is to re-route 100 % of traffic to the previous version:

```bash
# List recent versions (note the IDs and "created_on")
rtk pnpm exec wrangler versions list --env production

# Pin 100 % of traffic to the previous version
rtk pnpm exec wrangler versions deploy --version-id "<PREVIOUS_VERSION_ID>" --percentage 100

# Confirm
rtk pnpm exec wrangler versions list --env production
```

The change is immediate at the edge — no D1 migration, no rebuild, no
invalidation. Reports that were already issued are unaffected; their
D1 row + token hash remain valid until the 7-day retention expires.

## 4 · Disable new scans (if data compatibility is uncertain)

If the new ruleset emits findings that the old Worker can't render (or
vice versa), pause the public API until the regression is fixed:

```bash
# 1. Roll traffic back (Section 3).
# 2. Edit apps/workers/wrangler.jsonc to set:
#      "vars": { "SAFELAUNCH_SCAN_INTAKE_ENABLED": "false" }
# 3. Deploy the API Worker with the flag off:
rtk pnpm exec wrangler deploy --env production
# 4. Existing reports remain accessible via the private report URL.
# 5. Existing admin review queue is unaffected.
```

The flag is read at the top of the `/v1/scans` POST handler. Existing
report and admin endpoints keep working.

## 5 · Roll back D1 (last resort, irreversible)

Only do this if a migration applied in this release corrupted the
schema AND you cannot recover by re-deploying code. D1 roll-forward
is not supported — D1 cannot "downgrade" a schema. The recovery is to
restore from the **D1 snapshot** captured by the production workflow
(see `docs/runbooks/release.md` § 3 step 2).

```bash
# 1. Roll Worker traffic back (Section 3) and disable new scans (Section 4).
# 2. Download the most recent D1 snapshot artifact from GitHub Actions.
# 3. Restore via wrangler d1 execute --file db.sql or wrangler d1 import.
# 4. Re-deploy a Worker that was compatible with the pre-migration
#    schema. (The previous version is the safest candidate.)
# 5. Re-enable new scans and re-run smoke.
```

> **This is destructive.** Any data created between the snapshot and
> the rollback is lost. Notify stakeholders **before** executing.

## 6 · Verify after rollback

- `rtk node scripts/smoke.mjs --base-url "$PRODUCTION_URL"` — must PASS.
- `rtk pnpm -C packages/ai test -- eval-runner` — must PASS (regression
  suite is reproducible).
- Manually open the marketing homepage in both locales and submit a
  scan on a public URL.
- Manually open a previously-issued private report URL and confirm
  the payload is still served.
- Manually open `/admin/legal/` (gated by Cloudflare Access) and
  confirm the audit history is intact.

## 7 · Preserve audit evidence

Before you close the rollback ticket:

1. Attach the **Worker version diff** (old version ID → new version
   ID) to the incident.
2. Attach the **smoke output** (with timestamps) to the
   incident.
3. Attach the **D1 snapshot** (from the failed deploy) and any post-
   rollback verification snapshots.
4. If a D1 rollback was performed, attach the **before / after row
   counts** for `scans`, `evidence_items`, `findings`, `reports` to
   document the data loss window.
5. File a `legal_review_events` row noting the rollback (use the
   `disputed` field on an existing entry to avoid orphan rows).

## 8 · Post-rollback review

Within 24 hours, the release captain writes a one-page incident note
covering:

- What failed (eval gate, smoke, 5xx rate, schema).
- When it failed (timestamp of first signal vs. deploy).
- What was rolled back (Worker / Worker + flag / Worker + flag + D1).
- What the customer impact was (number of failed scans, if any).
- What the fix-forward plan is (PR link, ETA).

## 9 · Drill in staging

This runbook is rehearsed in staging before the first production
release. To re-run the drill:

```bash
# 1. Pick any previous staging deploy (Artifacts → D1 snapshot).
# 2. Roll traffic to the previous version (Section 3) on staging.
# 3. Run smoke + eval probes.
# 4. Optionally restore the D1 snapshot (Section 5) on a throwaway
#    staging environment.
# 5. Paste the command output into the next release PR.
```

## 10 · Change log

- `2026-07-30` — v1 runbook. First rehearsal pending.
- `2026-08-04` — Removed `scripts/check-latency.mjs` and its CICD step.
  Smoke + eval gate are now the only post-deploy gates.
