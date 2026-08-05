# ADMIN-03 — Usage metrics design

The dashboard reports four exact 24-hour counters and their previous-window
comparison: scans created, distinct sites scanned, reports successfully opened,
and active legal reviewers.

`scans.url_hash` is HMAC-SHA256 over the normalized hostname using the Worker
secret `METRICS_HASH_SALT`; raw URLs never enter the metrics response.
`reports.opened_at` is written on the first successful single-use token burn, so
the report metric measures opens rather than report existence. Both fields keep
the parent row's seven-day retention. Missing hashes are excluded and explicitly
mark the unique-site metric incomplete.
