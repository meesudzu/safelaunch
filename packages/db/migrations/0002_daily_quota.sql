-- 0002_daily_quota.sql
-- Adds redeem_codes + redeem_grants for the daily-domain-quota feature.
-- All existing tables (scans, reports, legal_*, etc.) are untouched.

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
  UNIQUE(code_id, domain_key, quota_day)
);

CREATE INDEX idx_redeem_grants_lookup ON redeem_grants(domain_key, quota_day);
CREATE INDEX idx_redeem_codes_active ON redeem_codes(expires_at) WHERE revoked_at IS NULL;
