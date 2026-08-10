# ADMIN-04 — Scan operations design

## Surfaces

- `GET /v1/admin/scans`: filtered, descending keyset list. Filters are state,
  jurisdiction, category, date range, and `live=true`. Page size is 50.
- `GET /v1/admin/scans/:id`: coverage, page progress, finding severity counts,
  analysis versions, and report availability. It never returns the report token.
- `/admin/scans`: server-rendered initial table. The live view polls a same-origin
  route every five seconds and stops when no non-terminal rows remain.
- `/admin/scans/:id`: operational detail without legal evidence text.

## Privacy and authorization

List and detail return only a 12-character prefix of `url_hash`; raw URL is not
selected from D1. Reveal is deferred until an `incident-response` Access role
can be cryptographically verified server-side. No browser-only role checks.

Cloudflare Access protection remains a production release blocker. Local coding
continues under the explicit deferred decision for `ADMIN-INFRA-01`.

## Pagination

Cursor is URL-safe base64 JSON containing `(created_at,id)`. The API validates
every filter and cursor, fetches 51 rows, returns 50, and derives the next cursor
from the last returned row.
