# SafeLaunch — Remaining work for the team

> **Generated:** 2026-08-03, after commit `0d5f259`.
> **Status of known hard gates (typecheck / lint / test / builds):** ✅ all green.
> **Status of live deployments:** API + Web live at `runany.dev`.
> **Items below are the gaps that remain between current state and a clean
> MVP release.**

This document is the handoff to the team. Items are grouped by **Tier**
(how blocking they are) and tagged with **Owner / Effort / Reference**.

---

## Tier 1 — Must do before any release announcement


### 1.2 Populate Vectorize `safelaunch-legal` with real embeddings
- **Why:** The seed in `scripts/seed-legal-corpus.sql` inserts 12
  provisions but `vector_id` is NULL on every row. The retrieval step
  in `makeWorkflowEvaluator` will fall back to "no retrieval results"
  → status `review` for everything.
- **Effort:** 4–6 hours (build a small one-shot script that calls
  Workers AI embedding for each provision, then `wrangler vectorize
  upsert`).
- **Owner:** Backend engineer.
- **Reference:**
  - `apps/workers/src/services/embed.ts` is already wired (uses
    `@cf/baai/bge-base-en-v1.5`, 768 dims).
  - `packages/ai/src/gateway.ts:embedText` and `embedBatch` exist.
  - `packages/ai/src/retrieval.ts:retrieveLegalContext` is the consumer.
- **How:**
  ```bash
  # One-shot script (not yet written — see template below):
  pnpm exec wrangler vectorize upsert --binding LEGAL_INDEX \
    --file <(node -e "
      const { readFileSync } = require('fs');
      const out = readFileSync('seed-vectors.jsonl', 'utf8').trim().split('\n')
        .map(JSON.parse)
        .map(({ id, vector, metadata }) => JSON.stringify({ id, vector, metadata }))
        .join('\n');
      process.stdout.write(out);
    ")
  ```
- **Deliverable:** updated `vector_id` column in `legal_provisions` for
  all 12 rows + matching vectors in the index.



---

## Tier 2 — Should do within the first week post-release

### 2.1 Populate embeddings via a proper vbpl.vn ingest pipeline
- **Why:** The current `scripts/seed-legal-corpus.sql` is hand-curated.
  Real production needs to crawl vbpl.vn, parse DOCX, and keep the
  corpus fresh.
- **Reference:** `apps/workers/src/queues/vbpl-docx.ts` already
  implements DOCX → Điều-level provisions parser.
- **Effort:** 1–2 days.
- **Owner:** Backend + Data engineer.
- **How:**
  1. Stand up the crawler that hits vbpl.vn listing pages (currently
     only the test fixtures exercise the parser).
  2. Use `pnpm exec wrangler queues consume safelaunch-legal-ingestion`
     with a local consumer for testing.
  3. Ingest ~50 high-priority documents covering the 4 MVP rules.
  4. Verify `legal_documents.status` flips `pending_review` → `approved`
     via the admin console.

### 2.2 Run the eval gate end-to-end against real Workers AI
- **Why:** The `pnpm -C packages/ai test -- eval-runner` runs against a
  stub. We have not exercised the 60-case benchmark with a real LLM.
- **Effort:** 2 hours.
- **Owner:** Backend engineer.
- **Reference:** `docs/compliance/eval-baseline.md` (4 metrics:
  `citationValidity=1.0`, `highRiskPrecision≥0.9`, `unsupportedHighRisk=0`,
  `p95LatencyMs<60_000`).
- **How:**
  1. Configure a Workers AI model binding on staging
     (`@cf/meta/llama-3.1-8b-instruct` per `packages/ai/src/provider.ts`).
  2. Replace `stubSystem` in `packages/ai/src/eval-runner.test.ts` with a
     real provider.
  3. Run `pnpm -C packages/ai test -- eval-runner`.
  4. If any gate fails, tune the system rules in `SYSTEM_RULES` or
     add more eval cases.


### 2.4 Replace outdated README.md
- **Why:** `README.md` still says
  *"Status: Early development. Application code (apps/, packages/)
  lands in follow-up commits."* That statement is 7+ commits stale.
- **Effort:** 15 minutes (or use the new `docs/readme.md` once it's merged).
- **Owner:** Tech writer / Backend engineer.
- **Reference:** `docs/readme.md` (this repo) supersedes it.

### 2.5 Add Playwright e2e suite
- **Why:** `tests/e2e/` is empty; the CI workflow runs `pnpm exec
  playwright test` against a non-existent suite.
- **Effort:** 1 day.
- **Owner:** Frontend engineer.
- **Reference:** `package.json:devDependencies:@playwright/test@1.62.0`
  is already installed; the runner is wired in
  `.github/workflows/ci.yml`.
- **Coverage to add:**
  - Submit a scan on `https://safelaunch.runany.dev/vi`
  - Verify the progress UI cycles states
  - Open the report URL, verify Vietnamese content + citation list
  - Submit the same scan again, verify "URL already burned" 410

### 2.6 Wire `TODO` items that we left in the code
- `apps/workers/src/routes/scans.ts:135-138` still has the `_reportToken`
  read from `payload_json` (this is intentional, B5 fix), but the
  field name is underscored on purpose — make sure the
  report composer (`makeWorkflowPersistReport` →
  `ReportRepository.upsert`) strips it before the second read in
  `apps/workers/src/routes/reports.ts:strip _reportToken`. (Currently
  working — verified by tests — but the dependency is implicit. Add
  a comment.)
- `apps/workers/src/routes/admin.ts` — `RESOLVED_ACTOR` reads
  `cf-access-authenticated-user-email` only. If the team wants the
  admin route to also accept service tokens (for CI-driven review),
  add `cf-access-client-id` / `cf-access-client-secret` validation.

---

## Tier 3 — Nice to have (no rush)

### 3.1 Real Vectorize embeddings for fixtures
- `tests/fixtures/vbpl/*.json` and `tests/fixtures/sites/*/index.html`
  are useful for unit tests but not currently used by any CI step.
  Wire them into the smoke / eval gate to catch regressions.


### 3.3 Clean up 15 stale worktrees
- `git worktree list` shows 15 leftover task-* and `safelaunch-mvp`
  worktrees. They reference dead branches. After one more clean
  release, prune them:
  ```bash
  git worktree remove --force .worktrees/task-9-evidence .worktrees/task-10-workflow \
    .worktrees/task-11-rules .worktrees/task-12-retrieval .worktrees/task-13-verify \
    .worktrees/task-14-report .worktrees/task-15-homepage .worktrees/task-16-progress \
    .worktrees/task-17-admin .worktrees/task-18-privacy .worktrees/task-19-eval \
    .worktrees/task-20-ci .worktrees/task-21-checklist .worktrees/safelaunch-mvp
  git branch -D codex/task-9-evidence codex/task-10-workflow ... feature/safelaunch-mvp
  ```

### 3.4 Bump `@types/node` in apps/web
- `pnpm install` warns that `vite` wants `@types/node >=22.12.0` but
  the lockfile resolves `22.10.5`. Cosmetic, not blocking.

### 3.5 Add scheduled cron for retention
- The retention service exists in `apps/workers/src/services/retention.ts`
  with idempotent purge logic, but no Cron Trigger is wired in
  `wrangler.jsonc`. Add:
  ```jsonc
  "triggers": [{ "crons": ["0 3 * * *"] }]
  ```
  So `purgeExpired` runs at 03:00 UTC daily.

### 3.6 Cloudflare Turnstile on `/v1/scans`
- `enforceAbuseControls` already supports Turnstile verification via
  `config.turnstile.secret`. Once we want to relax the per-IP rate
  limit, set `TURNSTILE_SECRET` as a Worker secret and pass the
  browser-issued token via `cf-turnstile-response` header.

### 3.7 Multi-jurisdiction expansion
- MVP is `VN` only. The contracts (`@safelaunch/contracts`) and
  compliance-core (`packages/compliance-core/src/jurisdictions.ts`) are
  written generically. To add a new jurisdiction: create another
  `R-*` rule set, add `seed-jurisdiction-X.sql`, add a jurisdiction
  option to the home form.

---

## Tier 4 — Already known small things (optional follow-ups)

- `apps/workers/src/routes/scans.ts` uses `extractTurnstileToken` which
  only reads the header but not the form body. Update when Turnstile
  is enabled.
- `apps/workers/src/services/abuse-rate-limiter-do.ts:53` casts `as
  unknown as Record<string, unknown>` to silence a TS-Wide × ESLint
  conflict. Could be cleaned by introducing a typed
  `CheckResponse` interface that matches the DO contract.
- `apps/workers/src/routes/admin.ts` logs `reasonLength` and
  `hasDocumentId` instead of the raw fields — keep this privacy
  guard.
- `apps/workers/src/queues/vbpl-docx.ts` is unit-tested via
  `vbpl-docx.test.ts` but the test fixtures are not exhaustive. Add
  edge cases (empty document, missing article, multi-clause).

---

## Quick reference: who-owns-what

| Area | Owner | Where |
|---|---|---|
| Worker API code | Backend | `apps/workers/src/` |
| Web app code | Frontend | `apps/web/src/` |
| Compliance rules | Legal + Backend | `packages/compliance-core/src/rules.ts`, `docs/compliance/rubrics/v1.md` |
| AI / LLM prompts | Backend | `packages/ai/src/provider.ts`, `evaluate.ts` |
| Cloudflare resources | Ops | `apps/workers/wrangler.jsonc`, `apps/web/wrangler.jsonc` |
| D1 schema | Backend | `packages/db/migrations/0001_initial.sql` |
| Legal corpus ingest | Backend + Data | `apps/workers/src/queues/vbpl-docx.ts`, `scripts/seed-legal-corpus.sql` |
| Admin review console | Frontend + Legal | `apps/web/src/app/admin/legal/`, `apps/workers/src/routes/admin.ts` |
| CI/CD | Ops | `.github/workflows/` |
| Docs | Tech writer | `docs/` |
| Eval gates | Backend | `packages/ai/src/eval-runner.ts`, `docs/compliance/eval-baseline.md` |

