# SafeLaunch — README

> _"Ra mắt toàn cầu. Tuân thủ ngay từ đầu."_
> _Launch globally. Compliant from day one._

SafeLaunch is an **AI-assisted legal & regulatory compliance platform** that
detects risks in a website **before** it ships. The MVP focuses on the
**Vietnam market** (online games, electronic press, digital entertainment)
and cites the underlying Vietnamese legal text (vbpl.vn) on every finding.

This document is the **canonical entry point** for the repo. It supersedes
the original top-level `README.md` (which has been reduced to a stub
pointing here).

---

## 1. Product snapshot

A visitor pastes a public website URL, picks an application category,
and within ≤60 seconds receives a **bilingual Vietnamese-English report**
that identifies potential legal risks and cites the relevant provisions
from official Vietnamese legal documents.

**MVP guarantees**

- No account, no signup, no payment.
- Every legal claim is cited (article + URL + retrieval date).
- Source-attributed answers: no hand-waving, no hidden legal advice.
- Single-use, expiring report link (24h lifetime + 7-day D1 retention).
- Privacy-by-design: hashed identifiers for rate-limit counters, no PII
  in logs.

**MVP non-goals** (per `docs/superpowers/specs/2026-07-28-safelaunch-mvp-design.md`)

- No definitive legal opinion.
- No Vietnam-only handling beyond VN (multi-jurisdiction is future work).
- No authenticated areas, no credential submission, no form submission.

---

## 2. Repository layout

```
.
├── AGENTS.md                          # entry point for every AI agent
├── apps/
│   ├── web/                          # Next.js 14 App Router — public marketing + product
│   │   ├── src/app/
│   │   │   ├── [locale]/             # /vi, /en routes (homepage + scan + report)
│   │   │   └── admin/legal/          # /admin/legal (admin queue — gated by Cloudflare Access)
│   │   ├── src/components/            # ScanForm, ScanProgress, ReportView, LegalReviewForm
│   │   ├── src/lib/                   # api-client, locale
│   │   ├── src/messages/              # vi/en translations
│   │   └── wrangler.jsonc             # OpenNext Cloudflare deploy config
│   └── workers/                       # Cloudflare Worker — API + scanner
│       ├── src/
│       │   ├── routes/                # /v1/scans, /v1/reports, /v1/admin/*
│       │   ├── workflows/              # scan-workflow (Cloudflare Workflow)
│       │   ├── services/               # safe-fetch, evidence, abuse-rate-limiter DO, etc.
│       │   ├── queues/                # vbpl-docx ingest consumer
│       │   ├── middleware/            # abuse controls (rate-limit + Turnstile)
│       │   ├── observability.ts       # privacy-first structured logger
│       │   └── index.ts               # Hono app, mounts all routers
│       └── wrangler.jsonc             # Cloudflare bindings + DO migrations
├── packages/
│   ├── contracts/                     # shared Zod schemas + TS types (no logic)
│   ├── compliance-core/               # pure rules engine, scoring, verify, aggregate
│   ├── ai/                            # retrieval (Vectorize) + LLM provider + eval runner
│   └── db/                            # Drizzle-style D1 repositories + migrations
├── scripts/
│   ├── smoke.mjs                      # production smoke probe
│   ├── check-latency.mjs              # latency probe (P50/P95/P99)
│   ├── seed-legal-corpus.sql          # 4 docs + 12 provisions MVP seed
│   └── setup-cloudflare-access.sh      # programmatic Access app + policy
├── tests/
│   ├── evals/cases/                   # 60 human-reviewed benchmark cases
│   └── fixtures/                      # site + vbpl fixtures
├── docs/
│   ├── README.md                      # this file
│   ├── remaining.md                   # handoff to the team (Tier 1/2/3/4)
│   ├── workflow.md                    # 4-phase AI-assisted dev workflow
│   ├── skills.md                      # skill catalog (must-invoke per change type)
│   ├── compliance/
│   │   ├── rubrics/v1.md              # binding spec for every RuleResult
│   │   └── eval-baseline.md           # release gate (citationValidity, etc.)
│   ├── design/homepage.md             # design direction for the home page
│   ├── operations/setup-and-deploy.md # deploy rituals
│   ├── privacy/data-inventory.md      # PII inventory
│   └── releases/mvp-release-checklist.md # release captain checklist
└── .github/workflows/
    ├── ci.yml                        # install + format + test + build + e2e + secret-scan
    ├── deploy-staging.yml            # auto-deploy to staging on push to main
    └── deploy-production.yml         # manual workflow_dispatch (10/50/100% traffic)
```

---

## 3. Architecture

```
                ┌─────────────────────────────────────────────────────────┐
                │                  SAFELAUNCH (live)                     │
                │                                                         │
   user →       │   ┌──────────────────┐    ┌────────────────────────┐     │
   browser  →   │   │   apps/web       │    │   apps/workers          │     │
                │   │   (Next.js +     │ →  │   (Cloudflare Worker    │     │
                │   │    OpenNext +    │    │    + Workflow + DO)     │     │
                │   │    Cloudflare    │    │                         │     │
                │   │    Pages)        │    │                         │     │
                │   └──────────────────┘    └────────────┬────────────┘     │
                │         safelaunch.runany.dev  safelaunch-api.runany.dev │
                └──────────────────────────────────────│──────────────────┘
                                                       │
   POST /v1/scans ──────────────────────────────────────┤
                                                       ▼
                                              ┌─────────────────┐
                                              │  scan-workflow   │
                                              │  (Cloudflare     │
                                              │   Workflows)     │
                                              └────────┬────────┘
                                                       │
   1. fetch homepage + about + privacy + contact + terms
      via safe-fetch (SSRF-protected, time/size bounded)
                                                       │
   2. extractEvidence(page) → EvidenceItem[]           │
                                                       │
   3. runRules({ jurisdiction, category, coverage,     │
      evidence }) → RuleResult[]                        │
                                                       │
   4. for each rule with outcome=unknown:               │
        retrieveLegalContext (Vectorize)               │
        → evaluateEvidenceProvisionPair (Workers AI)   │
        → verifyFinding (citation + legalQuote check)    │
                                                       │
   5. aggregateFindings → status (high_risk|            │
      needs_review|no_significant_risk)                 │
                                                       │
   6. persistReport → INSERT INTO reports (D1)         │
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │  D1 (safelaunch)│
                                              │  + R2 (snapshots)│
                                              │  + Vectorize    │
                                              │  + Queue         │
                                              │  + DO (rate-limit)│
                                              └─────────────────┘
```

Components (one-line summary):

| Layer   | Component                | File                                                               |
| ------- | ------------------------ | ------------------------------------------------------------------ |
| Edge    | AbuseRateLimiter DO      | `apps/workers/src/services/abuse-rate-limiter-do.ts`               |
| Edge    | Workflow `scan-workflow` | `apps/workers/src/workflows/scan-workflow.ts`                      |
| API     | Hono app + routers       | `apps/workers/src/index.ts`, `src/routes/*.ts`                     |
| Scanner | safe-fetch (SSRF)        | `apps/workers/src/services/safe-fetch.ts`                          |
| Scanner | evidence extractor       | `apps/workers/src/services/evidence.ts`                            |
| Domain  | rules + scoring          | `packages/compliance-core/src/{rules,scoring,aggregate,verify}.ts` |
| AI      | retrieval + LLM          | `packages/ai/src/{retrieval,provider,evaluate,translate}.ts`       |
| Data    | D1 repositories          | `packages/db/src/{scan,legal}-repository.ts`                       |
| UI      | Next.js pages            | `apps/web/src/app/`                                                |

---

## 4. Tech stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui.
- **Backend:** Cloudflare Workers + Hono + TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **AI:** Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5` for embeddings, `@cf/meta/llama-3.1-8b-instruct` for evaluation).
- **Storage:** D1 (relational), R2 (snapshots), Vectorize (semantic search), Queues (async ingest).
- **Edge compute:** Cloudflare Workflows (orchestration) + Durable Objects (rate-limit counters).
- **Auth:** Cloudflare Access (Zero Trust) — One-time PIN for admin reviewers.
- **Validation:** Zod 4 throughout (`@safelaunch/contracts` is shared).
- **Testing:** Vitest (148 unit tests across 6 packages), `pnpm -r test`.
- **Lint/Format:** ESLint (typescript-eslint recommendedTypeChecked), Prettier, `pnpm -r lint`.
- **Package manager:** pnpm 10.13.1 workspaces.

---

## 5. Local setup

### 5.1 Prerequisites

| Tool     | Version                       | Why                       |
| -------- | ----------------------------- | ------------------------- |
| Node.js  | 22.x (matches `.nvmrc`)       | Runtime                   |
| pnpm     | 10.13.1 (`corepack enable`)   | Workspace package manager |
| Wrangler | 4.114.0 (`pnpm dlx wrangler`) | Worker tooling            |
| Git      | any                           | Standard                  |

### 5.2 Bootstrap

```bash
git clone git@github.com:meesudzu/safelaunch.git safelaunch
cd safelaunch
pnpm install --frozen-lockfile     # installs all 6 workspaces
```

### 5.3 Run the hard gates (the same ones CI runs)

```bash
pnpm -r typecheck    # ✅ all 6 packages
pnpm -r lint         # ✅ all 6 packages
pnpm -r test         # ✅ 148 unit tests
cd apps/workers && pnpm build               # wrangler dry-run (writes worker-configuration.d.ts)
cd apps/web && NEXT_PUBLIC_API_ORIGIN=https://safelaunch-api.runany.dev pnpm build
```

### 5.4 Run the local dev servers

```bash
# 1. Apply migrations to local D1
cd apps/workers
pnpm exec wrangler d1 migrations apply DB --local

# 2. Run the Worker (terminal 1) — http://localhost:8787
pnpm exec wrangler dev

# 3. Run the Next.js dev server (terminal 2)
cd ../web
NEXT_PUBLIC_API_ORIGIN=http://localhost:8787 pnpm dev
# → http://localhost:3000  (locale defaults to /vi or /en via Accept-Language)
```

---

## 6. Deploy

### 6.1 Cloudflare resources (one-time)

```bash
# Auth
pnpm exec wrangler login

# D1
pnpm exec wrangler d1 create safelaunch
# → copy the printed id into apps/workers/wrangler.jsonc::d1_databases[0].database_id
pnpm exec wrangler d1 migrations apply DB --remote

# R2
pnpm exec wrangler r2 bucket create safelaunch-artifacts

# Vectorize (must match the embedding model's output dimensions)
pnpm exec wrangler vectorize create safelaunch-legal --dimensions 768 --metric cosine

# Queue
pnpm exec wrangler queues create safelaunch-legal-ingestion
```

### 6.2 Seed the legal corpus (4 docs, 12 provisions)

```bash
cd apps/workers
pnpm exec wrangler d1 execute DB --remote --file ../../scripts/seed-legal-corpus.sql
# 50 rows inserted across 13 tables.
```

Verify:

```bash
pnpm exec wrangler d1 execute DB --remote --command \
  "SELECT id, status, effective_from FROM legal_documents ORDER BY id"
```

### 6.3 Deploy the Worker (API)

```bash
cd apps/workers
pnpm exec wrangler deploy
# → https://safelaunch-api.new-dawn.workers.dev
# Custom domain: safelaunch-api.runany.dev (registered via wrangler.jsonc::routes)
```

### 6.4 Deploy the Web (Next.js → OpenNext → Cloudflare Workers)

```bash
cd apps/web
pnpm add -D @opennextjs/cloudflare@1.6.0 wrangler@4.114.0  # one-time
NEXT_PUBLIC_API_ORIGIN=https://safelaunch-api.runany.dev \
  pnpm exec opennextjs-cloudflare build
pnpm exec wrangler deploy
# → https://safelaunch-app.new-dawn.workers.dev
# Custom domain: safelaunch.runany.dev (registered via wrangler.jsonc::routes)
```

### 6.5 Enable Cloudflare Access for `/admin/legal/*`

```bash
# Programmatic (needs CF_API_TOKEN with access:org:write)
export CF_API_TOKEN=...
./scripts/setup-cloudflare-access.sh

# OR via dashboard: Zero Trust → Access → Applications → Add → Self-hosted
#   Domain: safelaunch.runany.dev  Path: /admin/legal/*
#   Policy: email_domain = safelaunch.app
```

### 6.6 Continuous deployment

`.github/workflows/ci.yml` runs `format → test → build → e2e → secret-scan`
on every PR and push to `main`.

`.github/workflows/deploy-staging.yml` runs on push to `main` (after CI passes):

- D1 migrations applied to staging
- API + Web deployed
- Smoke + eval + latency probes
- Redacted artifacts uploaded

`.github/workflows/deploy-production.yml` is `workflow_dispatch`:

- Re-runs CI against the chosen commit
- Exports D1 snapshot as 90-day rollback artifact
- Traffic shifts 10% → 50% → 100%

---

## 7. Updating the legal corpus (vbpl.vn ingest)

The legal corpus lives in D1 (`legal_documents`, `legal_provisions`,
`document_relations`, `legal_review_events`). The pipeline:

```
       crawler (out-of-band)
            │
            ▼
  ┌───────────────────────┐    POST /v1/admin/legal/:id/review
  │  vbpl.vn detail page   │    (admin reviewer approves/rejects)
  │  → DOCX download       │
  └────────────┬──────────┘
               ▼
       Queue: safelaunch-legal-ingestion
               ▼
       apps/workers/src/queues/vbpl-docx.ts
         unzips DOCX, parses word/document.xml
         extracts per-Điều article tree
         INSERT INTO legal_documents (status=pending_review)
         INSERT INTO legal_provisions
               ▼
       Admin queue at /admin/legal
         reviewer approves → status='approved'
         provision now retrievable via LegalRepository.listRetrievable
```

### 7.1 Ingest a new document end-to-end

```bash
# 1. Add the vbpl.vn detail page URL to the crawler seed list
#    (file: scripts/vbpl-seed-urls.txt — one URL per line)

# 2. Enqueue the DOCX download URL
pnpm exec wrangler queues producer safelaunch-legal-ingestion \
  --message '{"sourceUrl":"https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=...","detailPage":"https://vbpl.vn/TW/.../detail.html"}'

# 3. Consumer (vbpl-docx.ts) runs in the Worker as a queues consumer;
#    it INSERTs the new doc with status='pending_review'.

# 4. Reviewer opens https://safelaunch.runany.dev/admin/legal,
#    approves/rejects each pending doc. Approval flips status to
#    'approved' AND inserts an audit row into legal_review_events.

# 5. (Optional) Generate Vectorize embeddings for the new provisions.
#    Embed via Workers AI and `wrangler vectorize upsert`.
```

### 7.2 Add a new rule (e.g. R-AGE-1 for an age-gate)

1. Add the rule definition to
   `packages/compliance-core/src/rules.ts` (`RULES` constant).
2. Add the rubric entry to `docs/compliance/rubrics/v2.md`.
3. Bump `RUBRIC_VERSION` in `packages/compliance-core/src/scoring.ts`.
4. Seed at least 5 benchmark cases into `tests/evals/cases/`.
5. Re-run `pnpm -C packages/ai test -- eval-runner` and verify the
   gate passes.

---

## 8. Data flow for a single scan

```
POST /v1/scans                    (apps/workers/src/routes/scans.ts)
   body: { url, jurisdiction, category }
       │
       ├─ enforceAbuseControls (apps/workers/src/middleware/abuse.ts)
       │     ├─ AbuseRateLimiter DO  (sliding-window per (IP, host))
       │     └─ optional Turnstile verification
       │
       ├─ INSERT INTO scans (state='queued')
       ├─ env.SCAN_WORKFLOW.create({ params })
       └─ return 202 { scanId, state: "queued" }

   GET /v1/scans/:id  (poll)
       │
       ├─ SELECT scan row from D1
       └─ if terminal:
             SELECT reports.token_hash, reports.payload_json
                 FROM reports WHERE scan_id=?
             if token_hash IS NOT NULL:
                 return { ..., reportUrl: `${WEB_ORIGIN}/${locale}/report/${_reportToken}` }
             else:
                 return { ..., reportUrl: undefined }      // already burned

   GET /v1/reports/:scanId?token=X
       │
       ├─ SELECT reports.token_hash, payload_json WHERE scan_id=?
       ├─ if hash(X) === token_hash:
       │     UPDATE reports SET token_hash = NULL WHERE scan_id = ?   ← burn
       │     return payload_json with `_reportToken` stripped
       └─ else:
             return 410 Gone or 403 Forbidden
```

---

## 9. Hard gates (every PR)

| Gate          | Command                                                  | Expected                                                           |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Typecheck     | `pnpm -r typecheck`                                      | 6 packages, all pass                                               |
| Lint          | `pnpm -r lint`                                           | 6 packages, all pass                                               |
| Unit tests    | `pnpm -r test`                                           | 148 tests pass                                                     |
| Worker build  | `cd apps/workers && pnpm build`                          | wrangler dry-run OK                                                |
| Web build     | `cd apps/web && NEXT_PUBLIC_API_ORIGIN=... pnpm build`   | next build OK                                                      |
| Eval gate     | `pnpm -C packages/ai test -- eval-runner`                | citationValidity=1.0, highRiskPrecision≥0.9, unsupportedHighRisk=0 |
| Latency probe | `node scripts/check-latency.mjs --base-url $STAGING_URL` | P95 < 60s                                                          |

---

## 10. Privacy posture

- The `toLogEvent` helper in `apps/workers/src/observability.ts`
  enforces `path?, url?, token?, body?` as `never` at the type level.
  TypeScript prevents log calls that would leak URL paths or tokens.
- The `RESOLVED_ACTOR` helper in `apps/workers/src/routes/admin.ts`
  logs `actor + decision + reasonLength + hasDocumentId`, never the
  document id itself.
- The D1 schema has no PII columns. URL paths live in `scans.url`
  and are purged after 7 days via `apps/workers/src/services/retention.ts`.
- Per-IP rate-limit counters in `AbuseRateLimiter` are keyed on a
  **salted SHA-256 hash** of IP + hostname — never the raw IP.
- The full data inventory is in `docs/privacy/data-inventory.md`.

---

## 11. Where to ask for help

- **Compliance rubric** (`R-PRIV-1`, `R-OPID-1`, `R-CONT-1`, `R-LIC-1`):
  see `docs/compliance/rubrics/v1.md` and `packages/compliance-core/`.
- **AI prompts / system rules:** `packages/ai/src/provider.ts`
  (`SYSTEM_RULES`) and `packages/ai/src/evaluate.ts`.
- **Workflow orchestration:** `apps/workers/src/workflows/scan-workflow.ts`.
- **Why is the scan stuck?** Tail logs: `pnpm exec wrangler tail safelaunch-api --format=pretty`.
- **Why did CI fail?** `.github/workflows/ci.yml` prints the failing job;
  locally run `pnpm -r typecheck && pnpm -r lint && pnpm -r test`.

---

## 12. License

TBD (project pre-launch).
