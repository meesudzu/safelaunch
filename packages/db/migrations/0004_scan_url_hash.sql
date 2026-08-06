-- 0004_scan_url_hash.sql
--
-- Store a salted URL hash for admin usage metrics. Admin surfaces use this
-- field for distinct-site counts instead of exposing raw submitted URLs.

ALTER TABLE scans ADD COLUMN url_hash TEXT;
CREATE INDEX idx_scans_url_hash_created ON scans(url_hash, created_at);
