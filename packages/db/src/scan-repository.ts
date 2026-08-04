export interface NewScan {
  id: string;
  url: string;
  jurisdiction: string;
  category: string;
  analysisVersion: string;
  now: string;
  expiresAt: string;
}

export interface StoredScan {
  id: string;
  url: string;
  jurisdiction: string;
  category: string;
  state: string;
  coverage: Record<string, unknown>;
  analysisVersion: string;
  createdAt: string;
  expiresAt: string;
}

interface ScanRow {
  id: string;
  url: string;
  jurisdiction: string;
  category: string;
  state: string;
  coverage_json: string;
  analysis_version: string;
  created_at: string;
  expires_at: string;
}

export class ScanRepository {
  constructor(private readonly db: D1Database) {}

  async create(scan: NewScan): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO scans (id, url, jurisdiction, category, state, coverage_json, analysis_version, created_at, expires_at) VALUES (?, ?, ?, ?, 'queued', '{}', ?, ?, ?)",
      )
      .bind(
        scan.id,
        scan.url,
        scan.jurisdiction,
        scan.category,
        scan.analysisVersion,
        scan.now,
        scan.expiresAt,
      )
      .run();
  }

  async get(id: string): Promise<StoredScan | null> {
    const row = await this.db.prepare("SELECT * FROM scans WHERE id = ?").bind(id).first<ScanRow>();
    if (!row) return null;
    return {
      id: row.id,
      url: row.url,
      jurisdiction: row.jurisdiction,
      category: row.category,
      state: row.state,
      coverage: JSON.parse(row.coverage_json) as Record<string, unknown>,
      analysisVersion: row.analysis_version,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async updateTerminal(input: {
    id: string;
    state: string;
    coverage: Record<string, unknown>;
  }): Promise<void> {
    await this.db
      .prepare("UPDATE scans SET state = ?, coverage_json = ? WHERE id = ?")
      .bind(input.state, JSON.stringify(input.coverage), input.id)
      .run();
  }
}

export interface PersistReportInput {
  readonly scanId: string;
  readonly tokenHash: string;
  readonly payloadJson: string;
  readonly expiresAt: string;
}

export interface StoredReport {
  readonly scanId: string;
  readonly tokenHash: string | null;
  readonly payloadJson: string;
  readonly expiresAt: string;
}

interface ReportRow {
  scan_id: string;
  token_hash: string | null;
  payload_json: string;
  expires_at: string;
}

const toReport = (row: ReportRow): StoredReport => ({
  scanId: row.scan_id,
  tokenHash: row.token_hash,
  payloadJson: row.payload_json,
  expiresAt: row.expires_at,
});

export class ReportRepository {
  constructor(private readonly db: D1Database) {}

  async upsert(input: PersistReportInput): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO reports (scan_id, token_hash, payload_json, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(scan_id) DO UPDATE SET token_hash = excluded.token_hash, payload_json = excluded.payload_json, expires_at = excluded.expires_at",
      )
      .bind(input.scanId, input.tokenHash, input.payloadJson, input.expiresAt)
      .run();
  }

  async get(scanId: string): Promise<StoredReport | null> {
    const row = await this.db
      .prepare(
        "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
      )
      .bind(scanId)
      .first<ReportRow>();
    return row ? toReport(row) : null;
  }

  async getByTokenHash(tokenHash: string): Promise<StoredReport | null> {
    // Look up the report by its token hash. Used by the public report
    // page whose URL contains the one-time token, not the scanId.
    // Returns null after the token has been burned (token_hash IS NULL),
    // which gives us the single-use guarantee for free.
    const row = await this.db
      .prepare(
        "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE token_hash = ?",
      )
      .bind(tokenHash)
      .first<ReportRow>();
    return row ? toReport(row) : null;
  }

  async burnToken(scanId: string): Promise<void> {
    await this.db
      .prepare("UPDATE reports SET token_hash = NULL WHERE scan_id = ?")
      .bind(scanId)
      .run();
  }
}
