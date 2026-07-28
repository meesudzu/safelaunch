CREATE TABLE legal_documents (
  id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_review', 'approved', 'rejected', 'superseded')),
  retrieved_at TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  source_hash TEXT NOT NULL UNIQUE
);
CREATE TABLE legal_provisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  article TEXT NOT NULL,
  clause TEXT,
  text TEXT NOT NULL,
  vector_id TEXT,
  categories_json TEXT NOT NULL
);
CREATE TABLE document_relations (
  id TEXT PRIMARY KEY,
  from_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  to_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  relation_type TEXT NOT NULL CHECK(relation_type IN ('amends', 'supplements', 'replaces', 'repeals'))
);
CREATE TABLE legal_review_events (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  actor TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  category TEXT NOT NULL,
  state TEXT NOT NULL,
  coverage_json TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE scan_pages (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), page_type TEXT NOT NULL, url TEXT NOT NULL, state TEXT NOT NULL, content_hash TEXT, r2_key TEXT, excerpt_bytes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE evidence_items (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), type TEXT NOT NULL, value TEXT NOT NULL, source_url TEXT NOT NULL, excerpt TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1));
CREATE TABLE findings (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), severity TEXT NOT NULL, applicability TEXT NOT NULL, rationale TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1), recommended_action TEXT NOT NULL);
CREATE TABLE finding_citations (finding_id TEXT NOT NULL REFERENCES findings(id), provision_id TEXT NOT NULL REFERENCES legal_provisions(id), legal_excerpt TEXT NOT NULL, PRIMARY KEY(finding_id, provision_id));
CREATE TABLE reports (scan_id TEXT PRIMARY KEY REFERENCES scans(id), token_hash TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE rule_versions (id TEXT PRIMARY KEY, rubric_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id), rule_version_id TEXT NOT NULL REFERENCES rule_versions(id), model_id TEXT NOT NULL, prompt_version TEXT NOT NULL, retrieval_version TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX idx_legal_retrieval ON legal_documents(jurisdiction, status, effective_from, effective_to);
CREATE INDEX idx_scans_expiry ON scans(expires_at);
CREATE INDEX idx_reports_expiry ON reports(expires_at);
