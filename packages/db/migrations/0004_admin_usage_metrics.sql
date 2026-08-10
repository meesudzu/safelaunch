-- Privacy-preserving inputs for the admin usage dashboard.
ALTER TABLE scans ADD COLUMN url_hash TEXT;
ALTER TABLE reports ADD COLUMN opened_at TEXT;

CREATE INDEX idx_scans_created_metrics ON scans(created_at, url_hash);
CREATE INDEX idx_reports_opened_metrics ON reports(opened_at) WHERE opened_at IS NOT NULL;
CREATE INDEX idx_legal_review_created_actor ON legal_review_events(created_at, actor);
