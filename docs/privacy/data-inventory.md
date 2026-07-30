# SafeLaunch — Data Inventory

> Living document. Every piece of data the MVP collects, its purpose, where it
> lives, how long it is kept, who can read it, and how it is deleted.
> This file is the source of truth referenced by the retention service,
> observability layer, and the abuse middleware. Reviewed every release.

## 1 · Categories

SafeLaunch collects **two** distinct categories of data:

1. **Scan artefacts** — produced by a single user submitting a single URL to
   the `/v1/scans` endpoint. Every artefact in this category is associated
   with a per-scan `scanId` and a 7-day TTL.
2. **Aggregated operational metrics** — counters and histograms derived
   from scan events, kept indefinitely because they carry no
   identifying information.

The MVP does **not** collect authentication data. There is no user account,
no email, no cookie set by SafeLaunch itself. The only identifier that
links a scan to a network endpoint is the **salted hash of the client IP**,
which is kept only as a counter key in the abuse rate-limiter and never
written to logs.

## 2 · Per-field inventory

| Field | Purpose | Storage | Retention | Access | Deletion path |
| --- | --- | --- | --- | --- | --- |
| `scans.id` (UUID) | Public scan identifier | D1 `scans` | 7 days from `created_at` | None externally; opaque token-gated report endpoint | `purgeExpired` cron → `DELETE FROM scans WHERE expires_at < ?` |
| `scans.url` (string) | The website the user submitted | D1 `scans` | 7 days | Same as above | `purgeExpired` |
| `scans.jurisdiction`, `scans.category` | Scan parameters | D1 `scans` | 7 days | Same | `purgeExpired` |
| `scans.coverage_json` | Which pages were scanned | D1 `scans` | 7 days | Same | `purgeExpired` |
| `scans.analysis_version` | Rubric + model version used | D1 `scans` | 7 days | Same | `purgeExpired` |
| `scans.expires_at` | TTL anchor | D1 `scans` | Computed | Same | n/a (drives deletion) |
| `scan_pages.*` | Per-page R2 pointer + hash | D1 `scan_pages` | 7 days | Same | `DELETE FROM scan_pages WHERE scan_id IN (...)` |
| `evidence_items.*` | Typed facts extracted from the page | D1 `evidence_items` | 7 days | Same | `DELETE FROM evidence_items WHERE scan_id IN (...)` |
| `findings.*` | AI-proposed verdicts | D1 `findings` | 7 days | Same | `DELETE FROM findings WHERE scan_id IN (...)` |
| `finding_citations.*` | Provision links per finding | D1 `finding_citations` | 7 days | Same | `DELETE FROM finding_citations WHERE finding_id IN (...)` |
| `reports.payload_json` | Bilingual report payload | D1 `reports` | 7 days | Only with the **private** one-time token | `DELETE FROM reports WHERE expires_at < ?` |
| `reports.token_hash` | SHA-256 of the private report token | D1 `reports` | 7 days | n/a (one-way) | `purgeExpired` |
| R2 objects under `scans/<scanId>/<page>.html` | Page snapshots used during the scan | R2 `ARTIFACTS` | 7 days | None externally | `purgeExpired` deletes the prefix once the scan is expired |
| `legal_documents.*`, `legal_provisions.*` | The legal corpus (vbpl.vn derived) | D1 `legal_*` | Indefinite (corpus is public source) | Cloudflare Access-gated admin console | Manual re-ingest replaces; never deleted from inside the cron |
| Aggregated metrics (counters, P50/P95 latency) | Capacity + UX | D1 (proposed) / Worker Analytics | Indefinite | Operator dashboard | n/a — never includes PII |

## 3 · What is *not* collected

- No account, email, name, or password.
- No third-party tracking cookies, no Google Analytics, no Facebook pixel.
- No browser fingerprinting, no device fingerprinting.
- No raw HTTP bodies from the *user's* browser (only the URL they submitted).
- No persistent Cloudflare Access JWT in the browser; Access cookies are scoped to admin paths and never logged.

## 4 · Access matrix

| Reader | Can read |
| --- | --- |
| Anonymous visitor (no auth) | The scan submission endpoint, the report endpoint with a valid one-time token, the homepage. Nothing else. |
| Cloudflare Access (admin role) | `/admin/legal` queue + per-document review. Identity is server-derived from the validated JWT; the browser never sees the raw JWT and the form cannot supply an actor. |
| Worker Observability (logs / Workers Analytics) | The structured event stream emitted by `toLogEvent`. URL path, IP, body, and token are absent by construction. |

## 5 · Retention schedule

- **D1 scan artefacts** — 7 days from creation. Purged daily by the
  cron-triggered `purgeExpired` service in
  `apps/workers/src/services/retention.ts`. Idempotent: re-running on the
  same cutoff is a no-op.
- **R2 page snapshots** — 7 days. Deleted in the same pass; objects whose
  `uploaded` timestamp is older than the cutoff are removed, with
  conservative include for objects that lack an `uploaded` metadata.
- **Reports** — 7 days. The private one-time token is replaced with a
  null hash on first GET, so the URL is single-use even within the
  7-day window. After 7 days the row is deleted.
- **Legal corpus** — indefinite. The corpus is derived from vbpl.vn, a
  public source. Removing it would break report generation. Admin
  actions are logged to `legal_review_events` for audit.
- **Aggregated metrics** — indefinite. They are computed from the
  redacted event stream and contain no PII.

## 6 · Deletion safety

The retention service is **idempotent** and logs a single structured
`retention.purge` event with deletion counts. No URL path, IP, body, or
token is ever included in that event — the `toLogEvent` helper enforces
it at the type level (the `LogEvent` interface marks `path`, `url`,
`token`, and `body` as `never`).

A second invocation with the same cutoff deletes zero new artefacts,
so a replayed cron never produces duplicate-delete noise.

## 7 · Replay and audit

- The `legal_review_events` table is append-only. Admin approve / reject
  decisions never modify or delete prior events.
- The retention service is exercised by `purgeExpired` unit tests in
  `apps/workers/src/services/retention.test.ts`.
- The privacy-preserving event shape is exercised by
  `apps/workers/src/observability.test.ts`.
- A failed purge (D1 unavailable, R2 unavailable) surfaces as a thrown
  error from the cron. The service does not partially delete.

## 8 · Change log

- `2026-07-30` — v1 inventory written. The MVP ships with a 7-day retention
  on all scan artefacts and no persistent user data.
