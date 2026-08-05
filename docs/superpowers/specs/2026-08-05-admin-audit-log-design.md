# ADMIN-01 — Audit log viewer design

## Scope

Add a read-only audit endpoint and `/admin/audit` page over
`legal_review_events LEFT JOIN legal_documents`. This task does not add export,
bulk actions, or the shared admin shell.

## Contract

- Filters: `from`, `to`, `actor`, and normalized decision
  (`approved | rejected | pending`).
- Default date window: the last seven days.
- Pagination: descending keyset cursor on `(created_at, id)`, 50 rows per page.
- Response includes event ID, timestamp, actor, document ID/title,
  jurisdiction, normalized decision, and reason.
- Legacy stored decisions `approve` and `reject` are normalized at the API
  boundary.

## Privacy and security

- The page is internal-only and displays reviewer reason verbatim.
- No CSV/export is included. A future export must replace reason with `***`.
- No audit contents are logged by the endpoint or page.
- Cloudflare Access remains a release blocker even though its remote setup is
  deferred during local development.
