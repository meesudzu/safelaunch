# SafeLaunch — Admin Roadmap

> **Status:** design draft, pre-MVP.
> **Audience:** ops + product engineering.
> **Tag legend:** `[shipped]` = live today · `[build]` = scoped but not coded · `[idea]` = not yet scoped.

This doc lists the features the internal **admin console** should expose beyond the legal-review queue that exists today. Items are grouped by **Tier** (how blocking for MVP) and tagged with **Owner / Effort / Data source / UI surface / Privacy notes / Reference**.

A companion handoff document lives at [`remaining.md`](./remaining.md); items that already appear there (e.g. enabling Cloudflare Access) are referenced instead of duplicated.

---

## 1 · Architectural decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| URL shape | `/admin/*` — **no** locale prefix | Admin is internal-only, used by a small VN-based ops team. Locale indirection adds no value and forces every admin page to thread `params.locale` through the layout. |
| UI language | Vietnamese only (`apps/web/src/messages/admin-vi.json`) | Reviewers are a small VN-based ops team; `admin-en.json` was removed on 2026-08-03 to keep the admin UI single-source. The shared `LegalReviewForm` also dropped its `locale` prop and hardcodes `vi-VN` formatting. |
| Auth | Cloudflare Access — single shared `safelaunch.app` allow-list | One app, many reviewers; the JWT's `email` claim becomes the audit `actor`. |
| Hosting | Same Worker + Web pair as the public app, gated at the edge by Access | Reuses `apps/web` + `apps/workers` infrastructure; no separate admin deployment. |
| Transport | Server-rendered pages + small JSON endpoints | No SPA needed at this scale; admin pages are table-heavy, not interaction-heavy. |

> **Confirmed on 2026-08-03:** admin pages live at `apps/web/src/app/admin/legal/...` (no locale segment). Both page modules read `admin-vi.json` directly, expose no `params.locale`, and link with absolute `/admin/legal/...` paths. Public `/[locale]/report/...` and `/[locale]/scan/...` remain bilingual.

---

## 2 · Current admin surface (as of 2026-08-03)

| Surface | Path | Status |
| --- | --- | --- |
| Legal queue | `GET /v1/admin/legal/pending` | `[shipped]` |
| Legal doc detail | `GET /v1/admin/legal/:id` | `[shipped]` |
| Submit review | `POST /v1/admin/legal/:id/review` | `[shipped]` |
| Admin landing | `/admin` | `[shipped]` (server-side 307 → `/admin/legal`) |
| Legal queue UI | `/admin/legal` | `[shipped]` (route mount cleanup applied 2026-08-03) |
| Review form UI | `/admin/legal/:documentId` | `[shipped]` (same) |
| Audit log UI | — | **missing** (Tier 1) |
| Anything else | — | **missing** (this whole doc) |

Worker code: [`apps/workers/src/routes/admin.ts`](../apps/workers/src/routes/admin.ts).
Web pages: `apps/web/src/app/admin/legal/page.tsx`, `apps/web/src/app/admin/legal/[documentId]/page.tsx`.

Audit data already exists in the `legal_review_events` table ([`packages/db/migrations/0001_initial.sql`](../packages/db/migrations/0001_initial.sql)) but has no reader.

---

## 3 · Tier 1 — Critical (must ship before any reviewer logs in)

### 1.1 Cloudflare Access for `/admin/*`  `[shipped: doc · build: config]`

The Worker already trusts `cf-access-authenticated-user-email`, but no Access application is enforcing the gate at the edge. Without it the admin endpoints are reachable by anyone who can hit the API origin.

- **Effort:** 5 min.  **Owner:** ops.
- **How:** see [`remaining.md` §1.1](./remaining.md#11-enable-cloudflare-access-for-adminlegal).
- **Verify:** `curl https://safelaunch.runany.dev/admin/legal` → `302` to a Cloudflare Access sign-in page.

### 1.2 Audit log viewer  `[build]`

The `legal_review_events` table is the source of truth for "who decided what on which document". Today it is only readable by joining manually in `wrangler d1 execute`.

- **UI surface:** `GET /admin/audit`
- **Data source:** `legal_review_events` LEFT JOIN `legal_documents`
- **Columns:** `created_at`, `actor`, `document_title`, `jurisdiction`, `decision` (approved | rejected | pending), `reason`
- **Filters:** date range (default last 7 days), actor, decision
- **Pagination:** cursor on `created_at, id`; default page size 50
- **Privacy:** `reason` text rendered verbatim — admin-only role, but if PII ever enters the reason field we must redact with `***` for any export path.
- **Effort:** 0.5 day.  **Owner:** backend + frontend.
- **Reference:** `apps/workers/src/routes/admin.ts` already returns `audit` on the single-document endpoint — extract a list endpoint plus a thin web page.

### 1.3 Admin shell layout  `[build]`

Today each admin page rolls its own `<header>` + `<footer>`. We need a shared layout that:

- Sets the page title.
- Shows the signed-in admin's email (read from the `cf-access-authenticated-user-email` header forwarded by the Worker).
- Surfaces the Access logout link.
- Provides a nav: `Hàng đợi xét duyệt` · `Audit log` · (future) `Metrics` · `Logs`.

- **Effort:** 0.5 day.  **Owner:** frontend.
- **Reference:** `apps/web/src/app/admin/legal/page.tsx` is the canonical minimal admin page — copy its `<main>` skeleton when adding new admin routes.

---

## 4 · Tier 2 — Core operational dashboard (user-requested)

These are the metrics a reviewer or ops engineer actually wants to see when they open `/admin`. Each card on the dashboard has one D1 query behind it; the queries are listed inline so they double as the source of truth for the API contract.

### 2.1 Usage metrics — "how many uses"  `[build]`

- **UI surface:** `/admin/metrics` — top row, four KPI tiles
- **Tiles:**
  1. Scans in last 24h (lifetime delta vs previous 24h).
  2. Unique sites scanned in last 24h (`COUNT DISTINCT url_hash` — see privacy note).
  3. Reports opened in last 24h (proxy: `reports.expires_at` > now AND `reports.scan_id` joins a scan created in window).
  4. Active reviewer count in last 24h (`COUNT DISTINCT actor` from `legal_review_events`).

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

- **Privacy:** store a salted `url_hash` column on `scans` so the metric survives the 7-day purge without ever writing the raw URL. See [`docs/privacy/data-inventory.md`](./privacy/data-inventory.md).
- **Effort:** 1 day.  **Owner:** backend.

### 2.2 Site scan status table — "what's happening now"  `[build]`

- **UI surface:** `/admin/scans` — paginated, filterable table
- **Columns:** `created_at`, `scanId`, `jurisdiction`, `category`, `state` (one of `queued|fetching|extracting|retrieving|evaluating|reporting|completed|partial|failed`), `pages_done/total`, `expires_at`, link to `/admin/scans/:id`
- **Filters:** `state`, `jurisdiction`, `category`, date range
- **Refresh:** 5 s polling on the "live" tab (`state NOT IN ('completed','failed','partial')`), manual refresh elsewhere
- **Detail page:** `/admin/scans/:id` shows `coverage_json`, `findings` count by severity, `analysis_runs` (model + prompt versions), and a link to the public report token if still valid

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

- **Privacy:** show `id` and timestamps; the `url` field is PII per [`privacy/data-inventory.md`](./privacy/data-inventory.md), so display the truncated `url_hash` instead, with a "copy to clipboard" affordance for incident response only (and even that requires the Access "incident response" role).
- **Effort:** 1.5 days.  **Owner:** backend + frontend.

### 2.3 Redeem code inventory — "codes purchased & redeemed"  `[idea]`

There is no redeem-code infrastructure today — no table, no API, no event. This section captures the shape it should take.

- **Use case (hypothetical, pending product sign-off — see §8 Q1):** marketing distributes codes for free scans; ops needs to see how many codes were generated, how many were redeemed, and how many remain.

- **Proposed schema (new migration `0002_redeem_codes.sql`):**

```sql
CREATE TABLE redeem_codes (
  id TEXT PRIMARY KEY,                 -- e.g. "rc_…"
  code_hash TEXT NOT NULL UNIQUE,      -- SHA-256 of plaintext
  batch_id TEXT NOT NULL,              -- groups codes issued together
  issued_to TEXT,                      -- optional label, NOT PII
  issued_by TEXT NOT NULL,             -- admin actor
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_scan_id TEXT REFERENCES scans(id)
);
CREATE INDEX idx_redeem_batch ON redeem_codes(batch_id, issued_at);
CREATE INDEX idx_redeem_redeemed ON redeem_codes(redeemed_at) WHERE redeemed_at IS NOT NULL;
```

- **UI surface:** `/admin/redeem`
- **Tiles:**
  - Codes issued (lifetime, last 7d)
  - Codes redeemed (lifetime, last 7d)
  - Redemption rate (`redeemed / issued`)
  - Expiring soon (`expires_at < now + 7d` AND `redeemed_at IS NULL`)
- **Table:** batch_id · issued_at · issued_by · total · redeemed · expired · unused
- **Bulk actions:** generate N codes for a batch (returns plaintext codes **once**, then they are unrecoverable — admin must copy them)

- **Privacy:** the plaintext `code` exists in the admin's clipboard for ~10 seconds only. Storage is `code_hash`. `issued_to` is a label like "Q3 marketing campaign", never a person's name or email.
- **Effort:** 2 days (schema + API + UI + tests).  **Owner:** backend.
- **Blocked by:** §8 Q1.

### 2.4 System health — capacity & error rates  `[build]`

- **UI surface:** `/admin/health` — single page, one section per binding
- **Sections:**
  1. **D1** — row counts for each table, oldest non-expired scan, oldest pending review
  2. **R2 (`ARTIFACTS`)** — total bytes under `scans/` prefix, oldest object
  3. **Vectorize (`LEGAL_INDEX`)** — index vector count, last successful upsert timestamp
  4. **Queue (`LEGAL_INGESTION_QUEUE`)** — backlog depth (Workers Queue metrics)
  5. **Workflow (`SCAN_WORKFLOW`)** — in-flight instances, last 24h error rate
  6. **DO (`ABUSE_RATE_LIMITER`)** — active hashed keys (counter only)
  7. **Workers AI (`AI`)** — request count, average latency, error rate

- **Data source:** D1 introspection + Workers Analytics Engine
- **Example queries:**

```sql
-- D1 row counts
SELECT 'scans' AS table_name, COUNT(*) AS rows FROM scans
UNION ALL SELECT 'legal_documents', COUNT(*) FROM legal_documents
UNION ALL SELECT 'legal_review_events', COUNT(*) FROM legal_review_events;

-- Retention health
SELECT MIN(created_at) AS oldest_scan, MIN(expires_at) AS next_purge
FROM scans
WHERE expires_at > datetime('now');
```

- **Effort:** 1 day.  **Owner:** backend.
- **Reference:** [`apps/workers/src/services/retention.ts`](../apps/workers/src/services/retention.ts) already logs `retention.purge` events — health page should reflect the most recent one.

### 2.5 Compliance score distribution  `[build]`

- **UI surface:** `/admin/metrics#compliance` (second tab)
- **Charts:**
  - Histogram of `findings.severity` per scan, last 7d
  - Stacked bar: scans by `category` × median severity
  - Map (later): counts by `jurisdiction` — single jurisdiction for MVP
- **Data source:** `findings` joined to `scans`
- **Example query:**

```sql
SELECT f.severity, COUNT(*) AS n
FROM findings f
JOIN scans s ON s.id = f.scan_id
WHERE s.created_at >= datetime('now','-7 day')
GROUP BY f.severity;
```

- **Effort:** 1 day.  **Owner:** backend + frontend.

---

## 5 · Tier 3 — Logs & debugging

### 3.1 Worker log viewer  `[idea]`

The Worker emits structured events via `toLogEvent` ([`apps/workers/src/observability.ts`](../apps/workers/src/observability.ts)). Known event names today:

| Event | Emitted by | Useful for |
| --- | --- | --- |
| `request` | every request (default) | Traffic shape, error rate |
| `scan.created` | `routes/scans.ts` | Submission funnel |
| `scan.start` | `workflows/scan-workflow.ts` | Latency baseline |
| `scan.terminal` | `workflows/scan-workflow.ts` | Success count |
| `scan.failed_terminal` | `workflows/scan-workflow.ts` | Failure count |
| `scan.homepage_failed` | `workflows/scan-workflow.ts` | Upstream fetch issues |
| `scan.evaluated` | `workflows/scan-workflow.ts` | AI cost tracking |
| `evidence.extract_failed` | `workflows/scan-workflow.ts` | Per-page failure drill-down |
| `scan.workflow_create_failed` | `routes/scans.ts` | Infrastructure issues |
| `report.not_found` / `token_missing` / `token_mismatch` / `expired` | `routes/reports.ts` | Token UX |
| `admin.review.submitted` | `routes/admin.ts` | Reviewer activity |
| `retention.purge` | `services/retention.ts` | TTL health |

- **Approach:** ship Workers Logpush to R2 / Analytics Engine; build an admin page that queries Logpush directly with the filters above. Do **not** build a new logger — `toLogEvent` already enforces the privacy contract (no path, no IP, no body, no token).
- **Privacy:** every event in the table above already strips PII by construction. Re-check after each new event is added.
- **Effort:** 2 days once Logpush is enabled.  **Owner:** ops.
- **Blocked by:** §8 Q3.

### 3.2 Abuse signal feed  `[build]`

- **UI surface:** `/admin/abuse`
- **Source:** `AbuseRateLimiter` Durable Object (`apps/workers/src/services/abuse-rate-limiter-do.ts`)
- **Tiles:** blocked requests in last hour (by hashed IP), top blocked host-hashes, Turnstile pass/fail rate
- **Privacy:** the DO already stores only `ip_hash` and `host_hash`; admin never sees the raw values.
- **Effort:** 1 day.  **Owner:** backend.

### 3.3 Error rates per endpoint  `[build]`

- **UI surface:** `/admin/metrics#errors` (third tab)
- **Source:** `toLogEvent` with `level: "error"` — grouped by route template
- **Drill-down:** click a route to see the last 50 error events (already sanitised — `requestId` is `cf-ray` so it can be matched to the Cloudflare dashboard)
- **Effort:** 1 day.  **Owner:** backend.

---

## 6 · Tier 4 — Future

| Feature | Why | Effort |
| --- | --- | --- |
| Multi-tenant orgs | Today every reviewer sees the same global queue. Add an `org_id` column on `legal_review_events` and gate rows by JWT claim. | 1 week |
| Webhook config | Notify external systems when a scan hits `completed`. Store config in D1; emit via Queues. | 3 days |
| Public status page | Render the `/admin/health` data as `status.safelaunch.runany.dev` for users. | 2 days |
| Custom rule templates | Let admins create per-tenant compliance rules. Storage in R2, indexed in Vectorize. | 2 weeks |
| Reviewer SLAs | Track `time-to-decision` per reviewer; surface in the audit log. | 2 days |
| Bulk legal actions | Approve / reject N docs at once with a templated reason. | 1 day |

---

## 7 · Privacy & data boundary

The admin console inherits all the privacy guarantees in [`docs/privacy/data-inventory.md`](./privacy/data-inventory.md). The three rules that bind admin specifically:

1. **Raw URLs never leave the admin UI without an explicit "reveal" click**, and only for the `incident-response` Access role. Display `url_hash` everywhere else.
2. **No new PII collection.** If a new admin feature needs to store something attributable to a person (e.g. a reviewer note), it must be added to [`data-inventory.md`](./privacy/data-inventory.md) first with a retention column. Do not invent a side channel.
3. **Reason text is admin-visible but not exportable.** The CSV export path on `/admin/audit` (future) must redact the `reason` column.

---

## 8 · Open questions (need product sign-off)

1. **Do we ship redeem codes at all?** §2.3 is gated on this.
2. **Single reviewer team or multi-tenant orgs from day one?** Changes the schema for every table.
3. **Workers Logpush or third-party (Datadog/Honeycomb)?** §3.1 depends on this — Cloudflare-native keeps the data inside the existing compliance boundary but limits the query UI to Logpush filters.
4. **What is the SLA window for a pending legal review?** §1.2 audit page should highlight stale rows.

---

## 9 · References

- [`docs/remaining.md`](./remaining.md) — Tier 1/2/3 handoff list.
- [`docs/privacy/data-inventory.md`](./privacy/data-inventory.md) — PII + retention contract.
- [`docs/compliance/rubrics/v1.md`](./compliance/rubrics/v1.md) — severity enum reused by §2.5.
- [`apps/workers/src/routes/admin.ts`](../apps/workers/src/routes/admin.ts) — the only admin endpoints that exist today.
- [`apps/workers/src/observability.ts`](../apps/workers/src/observability.ts) — log event contract used by §3.1 and §3.3.
- [`apps/workers/src/services/retention.ts`](../apps/workers/src/services/retention.ts) — drives §2.4 retention tile.
- [`packages/db/migrations/0001_initial.sql`](../packages/db/migrations/0001_initial.sql) — source schema for every D1 query in this doc.
- [`packages/contracts/src/scan.ts`](../packages/contracts/src/scan.ts) — `ScanState` enum used by §2.2.
