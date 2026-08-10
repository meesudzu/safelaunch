# SafeLaunch — Admin Roadmap

> **Status:** design draft, pre-MVP.
> **Generated:** 2026-08-03 (initial).
> **Last reviewed:** 2026-08-10.
> **Audience:** ops + product engineering.
> **Tag legend:** `[shipped]` = live today · `[build]` = scoped but not coded · `[idea]` = not yet scoped.

This doc lists the features the internal **admin console** should expose beyond
the legal-review queue that exists today. Items are grouped by **Tier** (how
blocking for MVP) and tagged with **Owner / Effort / Data source / UI surface /
Privacy notes / Reference**.

A companion handoff document lives at [`remaining.md`](./remaining.md); the
team-wide release gates and "Recently shipped" log are there. This file is the
admin-only roadmap.

---

## 1 · Architectural decisions

| Decision    | Choice                                                                | Status      | Rationale                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL shape   | `/admin/*` — **no** locale prefix                                     | `[shipped]` | Admin is internal-only, used by a small VN-based ops team. Locale indirection adds no value and forces every admin page to thread `params.locale` through the layout.                                                |
| UI language | Vietnamese only (`apps/web/src/messages/admin-vi.json`)               | `[shipped]` | Reviewers are a small VN-based ops team; `admin-en.json` was removed on 2026-08-03 to keep the admin UI single-source. The shared `LegalReviewForm` also dropped its `locale` prop and hardcodes `vi-VN` formatting. |
| Auth        | Cloudflare Access — single shared `safelaunch.app` allow-list         | `[shipped]` | One app, many reviewers; the JWT's `email` claim becomes the audit `actor`. The Access application is now configured on the Cloudflare dashboard (2026-08-10).                                                       |
| Hosting     | Same Worker + Web pair as the public app, gated at the edge by Access | `[shipped]` | Reuses `apps/web` + `apps/workers` infrastructure; no separate admin deployment.                                                                                                                                     |
| Transport   | Server-rendered pages + small JSON endpoints                          | `[shipped]` | No SPA needed at this scale; admin pages are table-heavy, not interaction-heavy.                                                                                                                                     |

> **Confirmed on 2026-08-03:** admin pages live at `apps/web/src/app/admin/legal/...` (no locale segment). Both page modules read `admin-vi.json` directly, expose no `params.locale`, and link with absolute `/admin/legal/...` paths. Public `/[locale]/report/...` and `/[locale]/scan/...` remain bilingual.

---

## 2 · Current admin surface (as of 2026-08-10)

| Surface                                  | Path                                            | Status                                               |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Legal queue                              | `GET /v1/admin/legal/pending`                   | `[shipped]`                                          |
| Legal doc detail                         | `GET /v1/admin/legal/:id`                       | `[shipped]`                                          |
| Submit review                            | `POST /v1/admin/legal/:id/review`               | `[shipped]`                                          |
| Admin landing                            | `/admin`                                        | `[shipped]` (server-side 307 → `/admin/legal`)       |
| Legal queue UI                           | `/admin/legal`                                  | `[shipped]` (route mount cleanup applied 2026-08-03) |
| Review form UI                           | `/admin/legal/:documentId`                      | `[shipped]` (same)                                   |
| Cloudflare Access gate for `/admin/*`    | Cloudflare dashboard                            | `[shipped]` (configured 2026-08-10)                  |
| Redeem-code admin endpoints              | `apps/workers/src/routes/admin-redeem-codes.ts` | `[shipped]` (PR #36)                                 |
| Audit log UI                             | —                                               | **missing** (Tier 1)                                 |
| Admin shell layout (shared header / nav) | `apps/web/src/app/admin/layout.tsx` (to create) | **missing** (Tier 1)                                 |
| Kill switch / force-rescan               | —                                               | **missing** (Tier 1)                                 |
| Anything else                            | —                                               | **missing** (this whole doc)                         |

Worker code: [`apps/workers/src/routes/admin.ts`](../apps/workers/src/routes/admin.ts).
Web pages: `apps/web/src/app/admin/legal/page.tsx`, `apps/web/src/app/admin/legal/[documentId]/page.tsx`.

Audit data already exists in the `legal_review_events` table ([`packages/db/migrations/0001_initial.sql`](../packages/db/migrations/0001_initial.sql)) but has no reader.

---

## 3 · Tier 1 — Critical (must ship before any reviewer logs in)

### 1.1 Audit log viewer `[build]`

The `legal_review_events` table is the source of truth for "who decided what on which document". Today it is only readable by joining manually in `wrangler d1 execute`.

- **UI surface:** `GET /admin/audit`
- **Data source:** `legal_review_events` LEFT JOIN `legal_documents`
- **Columns:** `created_at`, `actor`, `document_title`, `jurisdiction`, `decision` (approved | rejected | pending), `reason`
- **Filters:** date range (default last 7 days), actor, decision
- **Pagination:** cursor on `created_at, id`; default page size 50
- **SLA highlight:** rows where `decision = 'pending'` AND `created_at < now() - <SLA window>` (per §8 Q3) get a yellow "stale" badge.
- **Privacy:** `reason` text rendered verbatim — admin-only role, but if PII ever enters the reason field we must redact with `***` for any export path.
- **Effort:** 0.5 day. **Owner:** backend + frontend.
- **Reference:** `apps/workers/src/routes/admin.ts` already returns `audit` on the single-document endpoint — extract a list endpoint plus a thin web page.

### 1.2 Kill switch — force rescan / evict embedding `[build]`

When a bad eval goes out (e.g. PR #38 model migration surfaces a regression,
or a fresh seed legal provision gets an inaccurate vector), the ops team needs
a way to recover without a code deploy.

- **UI surface:** `POST /admin/scans/:id/actions` with `action ∈ {rescan, evict_embedding, mark_failed}`
- **Endpoints:**
  - `rescan` — re-enqueue the same URL + category into `SCAN_WORKFLOW`. Persists
    a new `scans` row with `supersedes_id = :id` (new column; add in a follow-up migration) and writes a
    `scan.superseded` event so the report UI can show a banner. The old report
    link keeps its `expires_at` and the new report is published alongside.
  - `evict_embedding` — DELETE the `legal_provisions.vector_id` row from
    Vectorize, clear `vector_id` on the D1 row, and re-run
    `scripts/embed-legal-corpus.mjs --id <id>`. Requires the
    `incident-response` Access role.
  - `mark_failed` — set `scans.state = 'failed'` with a structured `kill_reason`
    text, emit `scan.killed` event, and unblock the abuse DO. Used when the
    URL is malicious and we want to short-circuit the workflow.
- **Privacy:** every action records `actor`, `action`, `target_id`,
  `reasonLength`, but never the raw reason text. (Same shape as
  `apps/workers/src/routes/admin.ts:submitReview`.)
- **Effort:** 1 day. **Owner:** backend.
- **Reference:** `apps/workers/src/workflows/scan-workflow.ts` and the
  Vectorize upsert path used by `scripts/embed-legal-corpus.mjs` are the
  integration points.

### 1.3 Admin shell layout `[build]`

Today each admin page rolls its own `<header>` + `<footer>`. We need a shared layout that:

- Sets the page title.
- Shows the signed-in admin's email (read from the `cf-access-authenticated-user-email` header forwarded by the Worker).
- Surfaces the Access logout link.
- Provides a nav: `Hàng đợi xét duyệt` · `Audit log` · (future) `Metrics` · `Logs`.

- **Effort:** 0.5 day. **Owner:** frontend.
- **Reference:** `apps/web/src/app/admin/legal/page.tsx` is the canonical minimal admin page — copy its `<main>` skeleton when adding new admin routes.

---

## 4 · Tier 2 — Core operational dashboard (user-requested)

These are the metrics a reviewer or ops engineer actually wants to see when they open `/admin`. Each card on the dashboard has one D1 query behind it; the queries are listed inline so they double as the source of truth for the API contract.

### 2.1 Usage metrics — "how many uses" `[build]`

- **UI surface:** `/admin/metrics` — top row, four KPI tiles
- **Tiles:**
  1. Scans in last 24h (lifetime delta vs previous 24h).
  2. Unique sites scanned in last 24h (`COUNT DISTINCT url_hash` — see privacy note).
  3. Reports opened in last 24h (proxy: `reports.expires_at` > now AND `reports.scan_id` joins a scan created in window).
  4. Active reviewer count in last 24h (`COUNT DISTINCT actor` from `legal_review_events` over events with a `submitReview` action; see note below).

- **Data source:** D1 + Workers Analytics Engine
- **Example queries:**

```sql
-- Scans in window
SELECT COUNT(*) AS scans
FROM scans
WHERE created_at >= ?;  -- ISO8601 lower bound

-- Unique sites scanned in window
SELECT COUNT(DISTINCT url_hash) AS sites
FROM scans
WHERE created_at >= ?;
```

- **Note on tile 4:** `COUNT DISTINCT actor)` returns the count of _distinct
  actors who performed at least one review event in the window_, not the
  count of unique reviewers per calendar day. If a reviewer reviews 5
  documents, that's still 1 distinct actor. The query:
  ```sql
  SELECT COUNT(DISTINCT actor) AS active_reviewers
  FROM legal_review_events
  WHERE created_at >= ?;
  ```
- **Privacy:** store a salted `url_hash` column on `scans` so the metric
  survives the 7-day purge without ever writing the raw URL. See
  [`docs/privacy/data-inventory.md`](./privacy/data-inventory.md).
- **Effort:** 1 day. **Owner:** backend.

### 2.2 Site scan status table — "what's happening now" `[build]`

- **UI surface:** `/admin/scans` — paginated, filterable table
- **Columns:** `created_at`, `scanId`, `jurisdiction`, `category`, `state` (one of `queued|fetching|extracting|retrieving|evaluating|reporting|completed|partial|failed`; `mark_failed` from §1.2 also lands here), `pages_done/total`, `expires_at`, link to `/admin/scans/:id`
- **Filters:** `state`, `jurisdiction`, `category`, date range
- **Refresh:** 5 s polling on the "live" tab (`state NOT IN ('completed','failed','partial')`), manual refresh elsewhere
- **Detail page:** `/admin/scans/:id` shows `coverage_json`, `findings` count by severity, `analysis_runs` (model + prompt versions), and a link to the public report token if still valid. If the scan was superseded, surface a "this scan was resuperseded by `<new_id>`" banner.
- **Data source:** `scans`, `scan_pages`, `findings`, `analysis_runs`
- **Example query:**

```sql
SELECT id, created_at, jurisdiction, category, state, expires_at
FROM scans
WHERE state NOT IN ('completed','failed','partial')
  AND created_at >= datetime('now','-1 day')
ORDER BY created_at DESC
LIMIT 100;
```

- **Privacy:** show `id` and timestamps; the `url` field is PII per
  [`privacy/data-inventory.md`](./privacy/data-inventory.md), so display the
  truncated `url_hash` instead, with a "copy to clipboard" affordance for
  incident response only (and even that requires the Access
  "incident-response" role).
- **Effort:** 1.5 days. **Owner:** backend + frontend.

### 2.3 Redeem code inventory — "codes purchased & redeemed" `[shipped: data path · build: ops inventory]`

The redeem-code data path is live (PR #36, `40ee93e`,
`apps/workers/src/services/redeem-codes.ts` + tests, and
`apps/workers/src/routes/admin-redeem-codes.ts` + tests), gated behind the
daily-domain-quota enablement (`ENABLE_DAILY_QUOTA`). The ops inventory UI is
the only piece still missing.

- **Use case:** marketing distributes codes for free scans; ops needs to see
  how many codes were generated, how many were redeemed, and how many remain.

- **Schema (live in `packages/db/migrations/0002_daily_quota.sql` —
  added by PR #36):**

```sql
CREATE TABLE redeem_codes (
  id TEXT PRIMARY KEY,                       -- "rc_<random>"
  code_hash TEXT NOT NULL UNIQUE,            -- SHA-256 hex of the plaintext
  label TEXT NOT NULL,                       -- free-text admin label
  created_by TEXT NOT NULL,                  -- cf-access-authenticated-user-email
  created_at TEXT NOT NULL,                  -- ISO 8601
  expires_at TEXT NOT NULL,                  -- ISO 8601
  revoked_at TEXT                            -- ISO 8601; soft-delete
);

CREATE TABLE redeem_grants (
  id TEXT PRIMARY KEY,                       -- "rg_<random>"
  code_id TEXT NOT NULL REFERENCES redeem_codes(id),
  domain_key TEXT NOT NULL,                  -- normalized host
  quota_day TEXT NOT NULL,                   -- "YYYY-MM-DD" UTC
  granted_at TEXT NOT NULL,                  -- ISO 8601
  scan_id TEXT REFERENCES scans(id)          -- filled when redeemed
);
```

- **UI surface:** `/admin/redeem`
- **Tiles:**
  - Codes issued (lifetime, last 7d)
  - Codes redeemed (lifetime, last 7d)
  - Redemption rate (`redeemed / issued`)
  - Expiring soon (`expires_at < now + 7d` AND `revoked_at IS NULL`)
- **Table (grouped by `label`):** label · created_at · created_by · total ·
  redeemed · revoked · unused
- **Bulk actions:** generate N codes under a shared `label` (returns
  plaintext codes **once**, then they are unrecoverable — admin must copy
  them)

- **Privacy:** the plaintext `code` exists in the admin's clipboard for ~10
  seconds only. Storage is `code_hash`. The `label` column is set to a tag like
  "Q3 marketing campaign", never a person's name or email.
- **Effort:** 2 days (UI + tests; schema + API already shipped). **Owner:**
  backend + frontend.
- **Reference:** `apps/workers/src/services/redeem-codes.ts`,
  `apps/workers/src/routes/admin-redeem-codes.ts`.

### 2.4 System health — capacity & error rates `[build]`

- **UI surface:** `/admin/health` — single page, one section per binding
- **Sections:**
  1. **D1** — row counts for each table (`scans`, `scan_pages`,
     `findings`, `finding_citations`, `evidence_items`, `analysis_runs`,
     `reports`, `rule_versions`, `legal_documents`, `legal_provisions`,
     `document_relations`, `legal_review_events`, `redeem_codes`,
     `redeem_grants`), oldest non-expired scan, oldest pending review
  2. **R2 (`ARTIFACTS`)** — total bytes under `scans/` prefix, oldest object
  3. **Vectorize (`LEGAL_INDEX`)** — index vector count, last successful
     upsert timestamp (read from the most recent `embed.success` event)
  4. **Queue (`LEGAL_INGESTION_QUEUE`)** — backlog depth (Workers Queue metrics)
  5. **Workflow (`SCAN_WORKFLOW`)** — in-flight instances, last 24h error rate
  6. **DO (`ABUSE_RATE_LIMITER`)** — active hashed keys (counter only)
  7. **Workers AI (`AI`)** — request count, average latency, error rate

- **Data source:** D1 introspection + Workers Analytics Engine
- **Example queries:**

```sql
-- D1 row counts (one UNION ALL per table; trimmed for brevity)
SELECT 'scans' AS table_name, COUNT(*) AS rows FROM scans
UNION ALL SELECT 'scan_pages', COUNT(*) FROM scan_pages
UNION ALL SELECT 'findings', COUNT(*) FROM findings
UNION ALL SELECT 'finding_citations', COUNT(*) FROM finding_citations
UNION ALL SELECT 'evidence_items', COUNT(*) FROM evidence_items
UNION ALL SELECT 'analysis_runs', COUNT(*) FROM analysis_runs
UNION ALL SELECT 'reports', COUNT(*) FROM reports
UNION ALL SELECT 'rule_versions', COUNT(*) FROM rule_versions
UNION ALL SELECT 'legal_documents', COUNT(*) FROM legal_documents
UNION ALL SELECT 'legal_provisions', COUNT(*) FROM legal_provisions
UNION ALL SELECT 'document_relations', COUNT(*) FROM document_relations
UNION ALL SELECT 'legal_review_events', COUNT(*) FROM legal_review_events
UNION ALL SELECT 'redeem_codes', COUNT(*) FROM redeem_codes
UNION ALL SELECT 'redeem_grants', COUNT(*) FROM redeem_grants;

-- Retention health
SELECT MIN(created_at) AS oldest_scan, MIN(expires_at) AS next_purge
FROM scans
WHERE expires_at > datetime('now');
```

- **Effort:** 1 day. **Owner:** backend.
- **Reference:** [`apps/workers/src/services/retention.ts`](../apps/workers/src/services/retention.ts) already logs `retention.purge` events — health page should reflect the most recent one.

### 2.5 Compliance score distribution `[build]`

- **UI surface:** `/admin/metrics#compliance` (second tab)
- **Charts:**
  - Histogram of `findings.severity` per scan, last 7d
  - Stacked bar: scans by `category` × **max severity per scan** (see note below)
  - Map (later): counts by `jurisdiction` — single jurisdiction for MVP
- **Data source:** `findings` joined to `scans`
- **Example query for the stacked bar (max severity per scan):**

```sql
WITH per_scan AS (
  SELECT f.scan_id, MAX(
    CASE f.severity
      WHEN 'critical' THEN 4
      WHEN 'high'     THEN 3
      WHEN 'medium'   THEN 2
      WHEN 'low'      THEN 1
      ELSE 0
    END
  ) AS max_severity_rank
  FROM findings f
  GROUP BY f.scan_id
)
SELECT s.category, p.max_severity_rank, COUNT(*) AS scans
FROM per_scan p
JOIN scans s ON s.id = p.scan_id
WHERE s.created_at >= datetime('now','-7 day')
GROUP BY s.category, p.max_severity_rank;
```

- **Note on "severity" math:** `findings.severity` is a categorical enum
  (`low | medium | high | critical`) — there is no median over a categorical
  set. Use either **max severity per scan** (recommended; query above) or
  **mode (most-frequent severity per scan)** if the team prefers a frequency
  view. The histogram on the first tab uses the raw `findings.severity`
  distribution and is unaffected.
- **Effort:** 1 day. **Owner:** backend + frontend.

---

## 5 · Tier 3 — Logs & debugging

### 3.1 Worker log viewer `[idea]`

The Worker emits structured events via `toLogEvent` ([`apps/workers/src/observability.ts`](../apps/workers/src/observability.ts)). Event names are split into two columns below — **shipped** (emitted today) and **planned** (will land alongside the feature that needs them). The Logpush UI must filter on the "shipped" subset at first and surface the "planned" ones as soon as their emitters are merged.

| Event                                                               | Status  | Emitted by / When                                                                  | Useful for                  |
| ------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | --------------------------- |
| `request`                                                           | shipped | every request (default)                                                            | Traffic shape, error rate   |
| `scan.created`                                                      | shipped | `routes/scans.ts`                                                                  | Submission funnel           |
| `scan.start`                                                        | shipped | `workflows/scan-workflow.ts`                                                       | Latency baseline            |
| `scan.terminal`                                                     | shipped | `workflows/scan-workflow.ts`                                                       | Success count               |
| `scan.failed_terminal`                                              | shipped | `workflows/scan-workflow.ts`                                                       | Failure count               |
| `scan.homepage_failed`                                              | shipped | `workflows/scan-workflow.ts`                                                       | Upstream fetch issues       |
| `scan.evaluated`                                                    | shipped | `workflows/scan-workflow.ts`                                                       | AI cost tracking            |
| `evidence.extract_failed`                                           | shipped | `workflows/scan-workflow.ts`                                                       | Per-page failure drill-down |
| `scan.workflow_create_failed`                                       | shipped | `routes/scans.ts`                                                                  | Infrastructure issues       |
| `report.not_found` / `token_missing` / `token_mismatch` / `expired` | shipped | `routes/reports.ts`                                                                | Token UX                    |
| `admin.review.submitted`                                            | shipped | `routes/admin.ts`                                                                  | Reviewer activity           |
| `retention.purge`                                                   | shipped | `services/retention.ts`                                                            | TTL health                  |
| `scan.superseded` / `scan.killed`                                   | planned | `routes/admin.ts` once §1.2 (kill switch) ships                                    | Operator actions            |
| `embed.success` / `embed.failure`                                   | planned | `scripts/embed-legal-corpus.mjs` (currently `console.log`; needs to migrate)       | Seed embedder audit         |
| `quota.exceeded` / `quota.bypass`                                   | planned | `services/quota-service.ts` (currently silent)                                     | Daily domain quota signal   |
| `eval.run_complete`                                                 | planned | `packages/ai/src/eval-runner.ts` (currently exits with a non-zero code on failure) | Eval gate status            |

- **Approach:** ship Workers Logpush to R2 / Analytics Engine; build an admin
  page that queries Logpush directly with the filters above. Do **not** build
  a new logger — `toLogEvent` already enforces the privacy contract (no path,
  no IP, no body, no token).
- **Privacy:** every event in the table above already strips PII by
  construction. Re-check after each new event is added.
- **Effort:** 2 days once Logpush is enabled. **Owner:** ops.
- **Blocked by:** §8 Q2.

### 3.2 Abuse signal feed `[build]`

- **UI surface:** `/admin/abuse`
- **Source:** `AbuseRateLimiter` Durable Object (`apps/workers/src/services/abuse-rate-limiter-do.ts`)
- **Tiles:** blocked requests in last hour (by hashed IP), top blocked
  host-hashes, Turnstile pass/fail rate
- **Privacy:** the DO already stores only `ip_hash` and `host_hash`; admin
  never sees the raw values.
- **Effort:** 1 day. **Owner:** backend.

### 3.3 Error rates per endpoint `[build]`

- **UI surface:** `/admin/metrics#errors` (third tab)
- **Source:** `toLogEvent` with `level: "error"` — grouped by route template
- **Drill-down:** click a route to see the last 50 error events (already
  sanitised — `requestId` is `cf-ray` so it can be matched to the Cloudflare
  dashboard)
- **Effort:** 1 day. **Owner:** backend.

---

## 6 · Tier 4 — Future

| Feature               | Why                                                                                                                          | Effort  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| Multi-tenant orgs     | Today every reviewer sees the same global queue. Add an `org_id` column on `legal_review_events` and gate rows by JWT claim. | 1 week  |
| Webhook config        | Notify external systems when a scan hits `completed`. Store config in D1; emit via Queues.                                   | 3 days  |
| Public status page    | Render the `/admin/health` data as `status.safelaunch.runany.dev` for users.                                                 | 2 days  |
| Custom rule templates | Let admins create per-tenant compliance rules. Storage in R2, indexed in Vectorize.                                          | 2 weeks |
| Reviewer SLAs         | Track `time-to-decision` per reviewer; surface in the audit log.                                                             | 2 days  |
| Bulk legal actions    | Approve / reject N docs at once with a templated reason.                                                                     | 1 day   |

---

## 7 · Privacy & data boundary

The admin console inherits all the privacy guarantees in [`docs/privacy/data-inventory.md`](./privacy/data-inventory.md). The three rules that bind admin specifically:

1. **Raw URLs never leave the admin UI without an explicit "reveal" click**, and only for the `incident-response` Access role. Display `url_hash` everywhere else.
2. **No new PII collection.** If a new admin feature needs to store something attributable to a person (e.g. a reviewer note), it must be added to [`data-inventory.md`](./privacy/data-inventory.md) first with a retention column. Do not invent a side channel.
3. **Reason text is admin-visible but not exportable.** The CSV export path on `/admin/audit` (future) must redact the `reason` column. The kill-switch reason text follows the same rule (see §1.2).
4. **The "incident-response" role is opt-in.** Cloudflare Access groups are
   the source of truth. Granting the role to a new reviewer requires a
   separate manual step in the dashboard; do not auto-add it from the admin
   UI.

---

## 8 · Open questions (need product sign-off)

1. **Single reviewer team or multi-tenant orgs from day one?** Changes the
   schema for every table. (Previously this doc also asked "do we ship
   redeem codes at all?" — that question is closed: PR #36 shipped the data
   path, only the inventory UI is pending.)
2. **Workers Logpush or third-party (Datadog/Honeycomb)?** §3.1 depends on
   this — Cloudflare-native keeps the data inside the existing compliance
   boundary but limits the query UI to Logpush filters.
3. **What is the SLA window for a pending legal review?** §1.1 audit page
   should highlight stale rows; need a concrete number (e.g. 48 h) to wire
   the badge.
4. **Do we want a "tier-1 reviewer" sub-role that can resolve a stale row
   but not a kill-switch?** Informs how §1.2 roles are split in Cloudflare
   Access.

---

## 9 · References

- [`docs/remaining.md`](./remaining.md) — Tier 1/2/3 handoff list and the
  team-wide "Recently shipped" log.
- [`docs/privacy/data-inventory.md`](./privacy/data-inventory.md) — PII +
  retention contract.
- [`docs/compliance/rubrics/v1.md`](./compliance/rubrics/v1.md) — severity
  enum reused by §2.5.
- [`docs/compliance/eval-baseline.md`](./compliance/eval-baseline.md) — eval
  gate metrics that drive §2.4.
- [`docs/compliance/ai-faq.md`](./compliance/ai-faq.md) — internal FAQ on
  Vectorize / Workers AI; useful when wiring §2.4.
- [`docs/operations/setup-and-deploy.md`](../operations/setup-and-deploy.md)
  — Cloudflare Access + AI Gateway ops.
- [`apps/workers/src/routes/admin.ts`](../apps/workers/src/routes/admin.ts) —
  the only admin endpoints that exist today.
- [`apps/workers/src/routes/admin-redeem-codes.ts`](../apps/workers/src/routes/admin-redeem-codes.ts) —
  the shipped redeem-code admin endpoints (PR #36).
- [`apps/workers/src/observability.ts`](../apps/workers/src/observability.ts) —
  log event contract used by §3.1 and §3.3.
- [`apps/workers/src/services/retention.ts`](../apps/workers/src/services/retention.ts) —
  drives §2.4 retention tile.
- [`packages/db/migrations/0001_initial.sql`](../packages/db/migrations/0001_initial.sql) —
  source schema for every D1 query in this doc.
- [`packages/contracts/src/scan.ts`](../packages/contracts/src/scan.ts) —
  `ScanState` enum used by §2.2.
- [`scripts/embed-legal-corpus.mjs`](../scripts/embed-legal-corpus.mjs) —
  the one-shot embedder referenced by §1.2 (`evict_embedding`) and §2.4
  (Vectorize health).
