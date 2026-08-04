# SafeLaunch — MVP Release Candidate Checklist

> Walk this document top to bottom before tagging a release. Every
> command in this checklist must exit 0 (or "skipped" for the e2e
> step) before the release captain signs the final line. Keep the
> filled-in copy attached to the release PR.

## 1 · Identity

- **Release candidate commit:** `____________________________` (paste the
  green CI SHA)
- **Ruleset / corpus version:** `vn-mvp-v1` (frozen for the MVP)
- **Model identifier:** `____________________________`
- **Release captain:** `____________________________`
- **Date (UTC):** `____________________________`

## 2 · Pre-flight

- [ ] The commit on `main` is the green tip of `.github/workflows/ci.yml`.
- [ ] The release PR description includes the green CI URL.
- [ ] No "do not merge" or "draft" labels remain on the release PR.
- [ ] The benchmark set under `tests/evals/cases/` has not changed since
      the previous successful release (otherwise the eval gate in § 4
      must pass against the new set and the `docs/compliance/eval-baseline.md`
      must be updated in the same PR).
- [ ] The data inventory in `docs/privacy/data-inventory.md` is up to date.
- [ ] The release and rollback runbooks under `docs/runbooks/` have been
      rehearsed in staging since the last release.

## 3 · Quality gates

Each command below must exit 0. Paste the last 10 lines of each output
into the PR description.

| #   | Gate                     | Command                                                                     | Result |
| --- | ------------------------ | --------------------------------------------------------------------------- | ------ |
| 1   | Lint                     | `rtk pnpm lint`                                                             | ☐ PASS |
| 2   | Typecheck                | `rtk pnpm typecheck`                                                        | ☐ PASS |
| 3   | Unit + integration tests | `rtk pnpm test`                                                             | ☐ PASS |
| 4   | Worker dry-run build     | `rtk pnpm -C apps/workers build`                                            | ☐ PASS |
| 5   | Web build                | `NEXT_PUBLIC_API_ORIGIN=https://api.example.com rtk pnpm -C apps/web build` | ☐ PASS |

## 4 · Legal evaluation gates

The release is **not eligible** unless both of these pass.

| #   | Gate          | Command                                                                      | Gate value                                                                     | Observed |
| --- | ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| 1   | Eval gate     | `rtk pnpm -C packages/ai test -- eval-runner`                                | `citationValidity = 1.0`, `highRiskPrecision ≥ 0.9`, `unsupportedHighRisk = 0` | ☐ PASS   |
| 2   | Latency probe | `rtk node scripts/check-latency.mjs --base-url "$STAGING_URL" --samples 100` | `P95 < 60 000 ms`                                                              | ☐ PASS   |

Capture the observed metrics in the PR:

```
citationValidity = ____________
highRiskPrecision = ____________
unsupportedHighRisk = ____________
p50 = ____________ ms
p95 = ____________ ms
p99 = ____________ ms
```

## 5 · Privacy gates

- [ ] `docs/privacy/data-inventory.md` lists every field the MVP collects.
- [ ] `apps/workers/src/observability.ts` keeps `LogEvent.path?` / `url?` /
      `token?` / `body?` as `never` so the type system refuses to log
      URL paths, request bodies, or report tokens.
- [ ] `apps/workers/src/services/retention.ts` is idempotent and deletes
      D1 + R2 artefacts past the 7-day expiry in a single pass.
- [ ] `apps/workers/src/middleware/abuse.ts` keys rate-limit counters by a
      salted IP / hostname hash, not raw values.
- [ ] The smoke + latency artifacts uploaded by the staging workflow
      contain no website content, no tokens, and no raw IPs.

## 6 · Operational gates

- [ ] `scripts/smoke.mjs` against staging returns exit 0.
- [ ] `scripts/check-latency.mjs` against staging returns exit 0.
- [ ] The D1 staging database has all forward-only migrations applied
      (`wrangler d1 migrations list DB --env staging` shows the latest
      migration).
- [ ] The legal corpus in staging contains only the reviewed fixture
      provisions (no production corpus leaked into staging).
- [ ] The Cloudflare Access policy for `/admin/legal/*` is in place and
      a test review (approve / reject) round-trips.

## 7 · Documentation gates

- [ ] `docs/runbooks/release.md` matches the steps the deploy workflows
      actually execute.
- [ ] `docs/runbooks/rollback.md` matches the rollback path the
      `wrangler versions deploy` command actually supports.
- [ ] `docs/compliance/eval-baseline.md` reflects the current gate
      thresholds (`citationValidity`, `highRiskPrecision`,
      `unsupportedHighRisk`, `p95LatencyMs`).
- [ ] `docs/design/homepage.md` is up to date with the Trust Sand palette
      and the editorial two-column macrostructure actually shipped.
- [ ] `README.md` is current (deployment links, commands, env vars).

## 8 · Sign-off

When every box above is checked and every "Result" cell is PASS, the
release captain signs below. **No release ships without this line.**

```
Signed: ____________________________
Role:   Release captain
Date:   ____________ (UTC)
Commit: ____________
Ruleset: vn-mvp-v1
```

## 9 · Post-release checklist (within 24 h)

- [ ] Marketing site URL (`https://safelaunch.app/{vi,en}/`) renders.
- [ ] A scan on `https://example.com/` reaches a terminal state within
      the latency budget.
- [ ] A report URL is single-use (the second open returns a 403 / 410).
- [ ] Admin queue at `https://safelaunch.app/admin/legal/` (gated by
      Cloudflare Access) shows at least one pending document.
- [ ] Deployment audit artifact uploaded by the production workflow is
      present in the run's artifacts.
- [ ] `docs/privacy/data-inventory.md` is unchanged unless the release
      intentionally changed what the MVP collects.

## 10 · Change log

- `2026-07-30` — v1 checklist. First MVP release will be signed against
  this template.
