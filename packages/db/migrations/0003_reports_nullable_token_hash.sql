-- 0003_reports_nullable_token_hash.sql
--
-- Make reports.token_hash nullable so ReportRepository.burnToken() can
-- null it out to enforce the single-use contract. Without this, the
-- single-use burn step fails with SQLITE_CONSTRAINT_NOTNULL the first
-- time anyone successfully opens a report.
--
-- SQLite does not support ALTER COLUMN ... DROP NOT NULL directly, so
-- we rebuild the table with the new shape. The existing reports rows
-- (if any) are copied over with their payload/expiry preserved.
--
-- Backward compat: WHERE token_hash = ? queries continue to work because
-- NULL never matches equality, so a burned row is correctly invisible to
-- the by-token lookup.

CREATE TABLE reports_new (
  scan_id TEXT PRIMARY KEY REFERENCES scans(id),
  token_hash TEXT UNIQUE,                    -- now nullable; NULL = consumed
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO reports_new (scan_id, token_hash, payload_json, expires_at)
  SELECT scan_id, token_hash, payload_json, expires_at FROM reports;

DROP TABLE reports;

ALTER TABLE reports_new RENAME TO reports;
