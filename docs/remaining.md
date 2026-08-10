# SafeLaunch — Remaining work for the team

> **Generated:** 2026-08-03 (initial, after commit `0d5f259`).
> **Last reviewed:** 2026-08-10 (through commit `40ee93e`).
> **Owner:** @friday.
> **Status of known hard gates (typecheck / lint / test / builds):** ✅ all green.
> **Status of live deployments:** API + Web live at `runany.dev`.
> **Items below are the gaps that remain between current state and a clean MVP release.**

This document is the handoff to the team. Items are grouped by **Tier** (how
blocking they are) and tagged with **Owner / Effort / Reference**. Cloudflare
Access for `/admin/*` is now configured on the Cloudflare dashboard (2026-08-10)
and is no longer tracked here — see [`docs/admin-roadmap.md`](./admin-roadmap.md)
for the rest of the admin build-out.

## Recently shipped

- **Daily domain quota + anonymous redeem-code bypass (2026-08-04).** Spec at
  `docs/superpowers/specs/2026-08-03-daily-domain-quota-design.md`. Plan at
  `docs/superpowers/plans/2026-08-03-daily-domain-quota-plan.md`. Gated by
  `ENABLE_DAILY_QUOTA` (default `false`); moved to a dashboard Variable
  (plaintext) in commit `642db6c`. Enable on staging first, then production,
  after a manual smoke run.
- **Vectorize `safelaunch-legal` population script + `legal_provisions.vector_id`
  back-fill (PR #25, 2026-08-10, `0cba336`).** Script at
  `scripts/embed-legal-corpus.mjs` (pure logic in
  `scripts/lib/embed-corpus-lib.mjs`, unit-tested in
  `scripts/lib/embed-corpus-lib.test.mjs`). Embeds all 12 seed provisions in a
  single batched Workers AI call routed through the Cloudflare AI Gateway
  (`gateway.ai.cloudflare.com`), upserts to the Vectorize index, then runs a
  single `UPDATE legal_provisions SET vector_id = id WHERE id IN (...)` so D1
  has the back-reference the production ingest pipeline relies on. Unit-tested
  with vitest at the repo root. To populate staging / production:
  ```bash
  CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
    node scripts/embed-legal-corpus.mjs --index safelaunch-legal
  ```
  Override the AI Gateway id with `CLOUDFLARE_AI_GATEWAY_ID=...` if not using
  the Cloudflare-reserved `default` gateway. Pass `--skip-vector-id-update` for
  a dry run that only touches Vectorize.
- **Scan workflow graph refactor + UI stepper alignment (PR #32, `0993b31`).**
  Spec at
  `docs/superpowers/specs/2026-08-06-scan-workflow-graph-refactor-design.md`,
  plan at
  `docs/superpowers/plans/2026-08-06-scan-workflow-graph-refactor-plan.md`.
  Inlines `step.do` and aligns the public progress stepper with the internal
  graph; the companion "degraded mode" design
  (`2026-08-06-scan-workflow-graph-degraded-design.md`) is also shipped.
  `scripts/check-step-graph.mjs` enforces step-name consistency in CI via
  `pnpm check:workflow-graph`.
- **Font evidence inspector + family grouping (PR #33, `d6174af`).** New
  `apps/workers/src/services/font-{inspector,grouping}.ts` parse declared and
  computed fonts and group them into families so the report can flag
  unlicensed embedded fonts. Tracked by the v2 font-evidence rubric
  `docs/compliance/rubrics/vn-mvp-v2-font-evidence-v1.md`.
- **Top-level `fontInventory` persistence + report view collapse + version
  0.0.14 / 0.0.15 (PRs #34 / #35, `4850d32` / `46981ec` / `b13d349` /
  `011963c`).** `fontInventory` is now written to the report payload and the
  report view collapses the redundant sections into the review tab
  (`a891f96`, `2ca4b6d`, `3e532b1`, `c99ab89`, `cd6fe81`, `631f749`) with a
  new IP law citation surfaced.
- **AI model migration: `llama-3.1-8b-instruct` → `llama-3.3-70b-instruct-fp8-fast`
  (PR #38, 2026-08-10, `32db11d`).** The old model is deprecated; the provider
  header in `packages/ai/src/provider.ts` records the switch. Eval cases
  (`packages/ai/src/eval-runner.ts`) re-validated with the new model. Rationale
  doc: `docs/superpowers/specs/2026-08-10-evaluation-model-migration.md`.
- **`EvaluationDraftSchema` relaxation + sanitised verifier errors
  (PR #39, `999d824`).** Lets the verifier return structured, sanitised
  errors for malformed LLM output without leaking internals to the public
  report. Defensive parser design:
  `docs/superpowers/specs/2026-08-10-defensive-llm-parser.md`.
- **Cloudflare default AI Gateway (`4764d8d`, docs `6c22108`).** Switched from
  a named gateway back to the Cloudflare-reserved `default` gateway for
  simpler ops; gateway usage clarified in
  `docs/operations/setup-and-deploy.md`.
- **Cloudflare Access for `/admin/*` (2026-08-10).** Application is configured
  on the Cloudflare dashboard; the Worker still trusts
  `cf-access-authenticated-user-email`. The corresponding item has been
  removed from this doc and from [`docs/admin-roadmap.md`](./admin-roadmap.md)
  §1.
- **Top-level `README.md` rewrite (2026-08-03).** The "Status: Early
  development…" stub has been replaced by the canonical product README
  pointing at `docs/README.md` as the doc index.
- **Admin redeeming feature (PR #36, `40ee93e`).** Work on the admin
  redeeming / review surface; see PR for scope and merged plan.
- **Scan workflow deterministic-first architecture docs (`8405323`,
  `62b85fb`, `d2830fa`).** `docs/operations/setup-and-deploy.md` now documents
  the deterministic-first phase ordering and the change log indent.

---

## Tier 1 — Must do before any release announcement

### 1.1 Populate Vectorize `safelaunch-legal` with real embeddings ✅ (shipped 2026-08-10, see "Recently shipped")

- **Why:** The seed in `scripts/seed-legal-corpus.sql` inserts 12 provisions
  but `vector_id` is NULL on every row. The retrieval step in
  `makeWorkflowEvaluator` would fall back to "no retrieval results" → status
  `review` for everything.
- **Owner:** Backend engineer.
- **Reference:**
  - `scripts/embed-legal-corpus.mjs` — one-shot embedder (Workers AI
    `@cf/baai/bge-base-en-v1.5`, 768 dims, AI Gateway routed).
  - `scripts/lib/embed-corpus-lib.mjs` — pure logic (unit-tested).
  - `packages/ai/src/gateway.ts:embedText` / `embedBatch` — used by the script.
  - `packages/ai/src/retrieval.ts:retrieveLegalContext` — the consumer.
- **Still needed for the REAL production release:** re-run the same script
  against the account once its Vectorize index exists:
  ```bash
  CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_API_TOKEN=<token> \
    node scripts/embed-legal-corpus.mjs --index safelaunch-legal
  ```

---

## Tier 2 — Should do within the first week post-release

### 2.1 Populate embeddings via a proper vbpl.vn ingest pipeline

- **Why:** The current `scripts/seed-legal-corpus.sql` is hand-curated. Real
  production needs to crawl vbpl.vn, parse DOCX, and keep the corpus fresh.
- **Reference:** `apps/workers/src/queues/vbpl-docx.ts` already implements the
  DOCX → Điều-level provisions parser.
- **Effort:** 1–2 days.
- **Owner:** Backend + Data engineer.
- **How:**
  1. Stand up the crawler that hits vbpl.vn listing pages (currently only the
     test fixtures exercise the parser).
  2. Use `pnpm exec wrangler queues consume safelaunch-legal-ingestion` with a
     local consumer for testing.
  3. Ingest ~50 high-priority documents covering the 4 MVP rules.
  4. Verify `legal_documents.status` flips `pending_review` → `approved` via
     the admin console.

### 2.2 Run the eval gate end-to-end against real Workers AI

- **Why:** `pnpm -C packages/ai test -- eval-runner` runs against a stub. We
  have not exercised the 60-case benchmark with a real LLM since the model
  migration (PR #38).
- **Effort:** 2 hours.
- **Owner:** Backend engineer.
- **Reference:** `docs/compliance/eval-baseline.md` (4 metrics:
  `citationValidity=1.0`, `highRiskPrecision≥0.9`, `unsupportedHighRisk=0`,
  `p95LatencyMs<60_000`).
- **How:**
  1. Confirm a Workers AI model binding on staging points at
     `@cf/meta/llama-3.3-70b-instruct-fp8-fast` per
     `packages/ai/src/provider.ts`.
  2. Replace `stubSystem` in `packages/ai/src/eval-runner.test.ts` with a
     real provider.
  3. Run `pnpm -C packages/ai test -- eval-runner`.
  4. If any gate fails, tune the system rules in `SYSTEM_RULES` or add more
     eval cases.

### 2.3 Expand Playwright e2e coverage

- **Why:** `tests/e2e/scan.spec.ts` already covers the happy path (homepage
  → submit → progress → report → single-use 410), but cookie banner, locale
  switching, error states, and admin login are not exercised end-to-end.
- **Effort:** 1 day.
- **Owner:** Frontend engineer.
- **Reference:** `package.json:devDependencies:@playwright/test@1.62.0` is
  already installed; the runner is wired in `.github/workflows/ci.yml`.
- **Coverage to add:**
  - Cookie banner appears + accept/dismiss states.
  - Locale switching (`/vi` ↔ `/en`) preserves the in-flight scan id.
  - Submitting an invalid URL → `400` with the Vietnamese error message.
  - Admin login via Cloudflare Access stub → `/admin/legal` queue renders.
  - Submitting a scan from `/en` → report renders bilingual copy.

### 2.4 Wire remaining `TODO` items that we left in the code

- **Why:** Two small follow-ups were intentionally deferred from the original
  release; both have working tests but the dependencies are implicit.
- **Effort:** 0.5 day.
- **Owner:** Backend engineer.
- **Items:**
  - `apps/workers/src/routes/scans.ts:135-138` reads `_reportToken` from
    `payload_json`. The report composer
    (`makeWorkflowPersistReport` → `ReportRepository.upsert`) must strip it
    before the second read in
    `apps/workers/src/routes/reports.ts:strip _reportToken`. **Currently
    working** — verified by tests — but the dependency is implicit. Add a
    comment.
  - `apps/workers/src/routes/admin.ts` — `RESOLVED_ACTOR` reads
    `cf-access-authenticated-user-email` only. Cloudflare Access is now
    configured on the dashboard, so the basic path works. **If** the team
    wants the admin route to also accept service tokens (for CI-driven
    review), add `cf-access-client-id` / `cf-access-client-secret`
    validation.

---

## Tier 3 — Operational follow-ups (nice to have, no rush)

### 3.1 Real Vectorize embeddings for fixtures

- `tests/fixtures/vbpl/*.json` and `tests/fixtures/sites/*/index.html` are
  useful for unit tests but not currently used by any CI step. Wire them into
  the smoke / eval gate to catch regressions.

### 3.2 Wire Logpush + baseline alerts (observability)

- **Why:** `apps/workers/src/observability.ts` already emits structured events
  with a privacy-respecting contract (no path, no IP, no body, no token), and
  `apps/workers/wrangler.jsonc` enables `traces`, `logs.persist`, and
  `invocation_logs`. We are not yet shipping those events to R2 / Analytics
  Engine, and there is no alerting on the release-gate SLOs.
- **Effort:** 1–2 days.
- **Owner:** Ops + Backend.
- **How:**
  1. Decide: Cloudflare-native Logpush (per
     `docs/admin-roadmap.md` §3.1) or third-party (Datadog / Honeycomb).
     Native keeps the data inside the existing compliance boundary.
  2. Configure the Logpush job: include only `toLogEvent` payloads, and
     add a safety-net filter that drops any field whose name contains
     `path`, `ip`, or `token`.
  3. Add `docs/operations/alerts.md` with thresholds for
     `scan.failed_terminal` rate, `p95LatencyMs` (release gate: < 60 000 ms
     per `docs/compliance/eval-baseline.md`), and D1 error rate.
  4. Wire the alerts to the team's notification channel (Slack / email).

### 3.3 D1 index check on the new tables

- **Why:** The workflow refactor (PR #32) and font evidence work (PR #33)
  added reads against `findings`, `analysis_runs`, and `scan_pages` from the
  admin surfaces. We have not run `EXPLAIN QUERY PLAN` on the queries in
  `admin-roadmap.md` §2.2 / §2.4 / §2.5 to confirm indexes cover them.
- **Effort:** 0.5 day.
- **Owner:** Backend.
- **How:**
  1. List every D1 query in `admin-roadmap.md` and the report composer.
  2. For each, run `EXPLAIN QUERY PLAN` against a local D1 seed.
  3. Add covering indexes in a new migration if any plan shows a full table
     scan.
  4. Document the verified plans in `packages/db/INDEXES.md`.

### 3.4 Clean up stale worktrees

- `git worktree list` shows 4 worktrees total: 1 main, 2 feature
  (`codex/report-font-dedup`, `codex/font-license-evidence`), 1 prunable
  (`.worktrees/fix-scan-pipeline-e2e`). After one more clean release, prune
  the dead ones and delete their branches:
  ```bash
  git worktree remove --force .worktrees/fix-scan-pipeline-e2e
  git worktree remove --force ../safelaunch-report-font-dedup
  git worktree remove --force ../safelaunch.codex-font-evidence
  # (only after the feature branches are merged or abandoned)
  git branch -D codex/fix-scan-pipeline-e2e codex/report-font-dedup \
    codex/font-license-evidence
  ```

### 3.5 Bump `@types/node` in `apps/web`

- `pnpm install` warns that `vite` wants `@types/node >=22.12.0` but the
  lockfile resolves `22.10.5`. Cosmetic, not blocking.

### 3.6 Add scheduled cron for retention

- The retention service exists in `apps/workers/src/services/retention.ts`
  with idempotent purge logic, but no Cron Trigger is wired in
  `wrangler.jsonc`. Add:
  ```jsonc
  "triggers": [{ "crons": ["0 3 * * *"] }]
  ```
  So `purgeExpired` runs at 03:00 UTC daily.

### 3.7 Cloudflare Turnstile on `/v1/scans`

- `enforceAbuseControls` already supports Turnstile verification via
  `config.turnstile.secret`. Once we want to relax the per-IP rate limit, set
  `TURNSTILE_SECRET` as a Worker secret and pass the browser-issued token via
  the `cf-turnstile-response` header. (Note: `apps/workers/src/routes/scans.ts`
  currently reads the token only from the header, not the form body — see
  §4.1.)

### 3.8 Multi-jurisdiction expansion

- MVP is `VN` only. The contracts (`@safelaunch/contracts`) and
  compliance-core (`packages/compliance-core/src/jurisdictions.ts`) are
  written generically. To add a new jurisdiction: create another `R-*` rule
  set, add `seed-jurisdiction-X.sql`, add a jurisdiction option to the home
  form.

---

## Tier 4 — Small known follow-ups (numbered for reference)

### 4.1 `extractTurnstileToken` should also read the form body

- `apps/workers/src/routes/scans.ts` uses `extractTurnstileToken`, which only
  reads the `cf-turnstile-response` header but not the form body. Update when
  Turnstile is enabled (Tier 3.7).

### 4.2 Type the `AbuseRateLimiter` DO contract

- `apps/workers/src/services/abuse-rate-limiter-do.ts:53` casts
  `as unknown as Record<string, unknown>` to silence a TS-wide × ESLint
  conflict. Clean it up by introducing a typed `CheckResponse` interface
  that matches the DO contract and exporting it from
  `packages/contracts/src/abuse.ts`.

### 4.3 Keep the admin reason-text privacy guard

- `apps/workers/src/routes/admin.ts` logs `reasonLength` and `hasDocumentId`
  instead of the raw fields — keep this privacy guard. When the audit-log
  CSV export path in `admin-roadmap.md` §1.2 lands, ensure the privacy guard
  is mirrored there (reason column redacted on export).

### 4.4 Expand `vbpl-docx` test fixtures

- `apps/workers/src/queues/vbpl-docx.ts` is unit-tested via
  `vbpl-docx.test.ts` but the test fixtures are not exhaustive. Add edge
  cases: empty document, missing article, multi-clause, mixed-language
  paragraphs.

---

## Quick reference: who-owns-what

| Area                  | Owner            | Where                                                                                                                           |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Worker API code       | Backend          | `apps/workers/src/`                                                                                                             |
| Web app code          | Frontend         | `apps/web/src/`                                                                                                                 |
| Compliance rules      | Legal + Backend  | `packages/compliance-core/src/rules.ts`, `docs/compliance/rubrics/v1.md`                                                        |
| Compliance rubrics v2 | Legal + Backend  | `docs/compliance/rubrics/vn-mvp-v2-licensing-digital-rights-strict.md`, `docs/compliance/rubrics/vn-mvp-v2-font-evidence-v1.md` |
| AI / LLM prompts      | Backend          | `packages/ai/src/{provider,evaluate,retrieval,gateway}.ts`                                                                      |
| Cloudflare resources  | Ops              | `apps/workers/wrangler.jsonc`, `apps/web/wrangler.jsonc`                                                                        |
| D1 schema             | Backend          | `packages/db/migrations/0001_initial.sql`                                                                                       |
| Legal corpus ingest   | Backend + Data   | `apps/workers/src/queues/vbpl-docx.ts`, `scripts/seed-legal-corpus.sql`                                                         |
| Embed corpus script   | Backend          | `scripts/embed-legal-corpus.mjs`, `scripts/lib/embed-corpus-lib.mjs`                                                            |
| Admin review console  | Frontend + Legal | `apps/web/src/app/admin/legal/`, `apps/workers/src/routes/admin.ts`                                                             |
| Admin ops console     | Frontend + Ops   | `docs/admin-roadmap.md` (the remaining admin build-out)                                                                         |
| CI/CD                 | Ops              | `.github/workflows/`                                                                                                            |
| Docs                  | Tech writer      | `docs/`                                                                                                                         |
| Eval gates            | Backend          | `packages/ai/src/eval-runner.ts`, `docs/compliance/eval-baseline.md`                                                            |
| Observability         | Ops + Backend    | `apps/workers/src/observability.ts`, `apps/workers/wrangler.jsonc`                                                              |
