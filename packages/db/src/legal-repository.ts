export interface NewLegalDocument {
  id: string;
  jurisdiction?: string;
  sourceUrl: string;
  title: string;
  retrievedAt: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceHash: string;
}

export interface NewLegalProvision {
  id: string;
  documentId: string;
  article: string;
  clause: string | null;
  text: string;
  categories: string[];
}

export interface RetrievableProvision extends NewLegalProvision {
  sourceUrl: string;
  title: string;
  retrievedAt: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export const isApplicable = (
  document: { status: string; effectiveFrom: string | null; effectiveTo: string | null },
  on: string,
): boolean =>
  document.status === "approved" &&
  (!document.effectiveFrom || document.effectiveFrom <= on) &&
  (!document.effectiveTo || document.effectiveTo > on);

export class LegalRepository {
  constructor(private readonly db: D1Database) {}

  async createDocument(document: NewLegalDocument): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO legal_documents (id, jurisdiction, source_url, title, status, retrieved_at, effective_from, effective_to, source_hash) VALUES (?, ?, ?, ?, "pending_review", ?, ?, ?, ?)',
      )
      .bind(
        document.id,
        document.jurisdiction ?? "VN",
        document.sourceUrl,
        document.title,
        document.retrievedAt,
        document.effectiveFrom,
        document.effectiveTo,
        document.sourceHash,
      )
      .run();
  }

  async addProvision(provision: NewLegalProvision): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO legal_provisions (id, document_id, article, clause, text, categories_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        provision.id,
        provision.documentId,
        provision.article,
        provision.clause,
        provision.text,
        JSON.stringify(provision.categories),
      )
      .run();
  }

  async approve(documentId: string, actor: string, reason: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          'UPDATE legal_documents SET status = "approved" WHERE id = ? AND status = "pending_review"',
        )
        .bind(documentId),
      this.db
        .prepare(
          'INSERT INTO legal_review_events (id, document_id, actor, decision, reason, created_at) VALUES (?, ?, ?, "approved", ?, ?)',
        )
        .bind(crypto.randomUUID(), documentId, actor, reason, now),
    ]);
  }

  async listRetrievable(input: {
    jurisdiction: string;
    category: string;
    on: string;
  }): Promise<RetrievableProvision[]> {
    const result = await this.db
      .prepare(
        `SELECT p.id, p.document_id, p.article, p.clause, p.text, p.categories_json,
        d.source_url, d.title, d.retrieved_at, d.effective_from, d.effective_to
        FROM legal_provisions p JOIN legal_documents d ON d.id = p.document_id
        WHERE d.jurisdiction = ? AND d.status = "approved"
          AND (d.effective_from IS NULL OR d.effective_from <= ?)
          AND (d.effective_to IS NULL OR d.effective_to > ?)
          AND EXISTS (SELECT 1 FROM json_each(p.categories_json) WHERE value = ?)
        ORDER BY d.effective_from, p.article, p.clause`,
      )
      .bind(input.jurisdiction, input.on, input.on, input.category)
      .all<Record<string, string | null>>();

    return result.results.map((row) => ({
      id: String(row.id),
      documentId: String(row.document_id),
      article: String(row.article),
      clause: row.clause ?? null,
      text: String(row.text),
      categories: JSON.parse(String(row.categories_json)) as string[],
      sourceUrl: String(row.source_url),
      title: String(row.title),
      retrievedAt: String(row.retrieved_at),
      effectiveFrom: row.effective_from ?? null,
      effectiveTo: row.effective_to ?? null,
    }));
  }
}
