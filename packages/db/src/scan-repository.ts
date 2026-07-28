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
}
