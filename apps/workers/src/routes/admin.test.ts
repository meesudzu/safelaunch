import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { adminRouter } from "./admin";

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

const jsonBody = async <T>(response: Response): Promise<T> =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  (await response.json()) as unknown as T;

class FakeD1 {
  rows: Array<{
    sql: string;
    firstReturn: unknown;
    allReturn: unknown[];
  }> = [];
  preparedCalls: QueryCall[] = [];
  batchCalls: QueryCall[][] = [];

  prepare(sql: string) {
    const stmt = {
      bind: (...bindings: unknown[]) => {
        this.preparedCalls.push({ sql, bindings });
        const row = this.rows.find((entry) => entry.sql === sql || sql.includes(entry.sql));
        const first = row?.firstReturn ?? null;
        const all = row?.allReturn ?? [];
        return {
          first: async <T>(): Promise<T | null> => {
            await Promise.resolve();
            return first as T | null;
          },
          all: async <T>(): Promise<{ results: T[]; success: boolean; meta: unknown }> => {
            await Promise.resolve();
            return { results: all as T[], success: true, meta: {} };
          },
          run: async (): Promise<{ results: unknown[]; success: boolean; meta: unknown }> => {
            await Promise.resolve();
            return {
              results: [],
              success: true,
              meta: {},
            };
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    await Promise.resolve();
    this.batchCalls.push(statements.map(() => ({ sql: "", bindings: [] as unknown[] })));
    return [];
  }

  exec(): Promise<D1ExecResult> {
    return Promise.resolve({ count: 0, duration: 0 });
  }
  withSession(): D1DatabaseSession {
    return {} as D1DatabaseSession;
  }
  async dump(): Promise<ArrayBuffer> {
    await Promise.resolve();
    return new ArrayBuffer(0);
  }
}

const buildApp = () => {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.route("/v1/admin", adminRouter);
  return app;
};

const runWithDb = async (db: FakeD1, request: Request): Promise<Response> => {
  const app = buildApp();
  return app.fetch(request, { DB: db as unknown as D1Database });
};

describe("admin router", () => {
  describe("admin scan operations", () => {
    it("lists scans with truncated hashes and no raw URL", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT s.id, s.url_hash",
        firstReturn: null,
        allReturn: [
          {
            id: "scan-1",
            url_hash: "abcdef1234567890",
            jurisdiction: "VN",
            category: "online_game",
            state: "fetching",
            created_at: "2026-08-05T00:00:00.000Z",
            expires_at: "2026-08-12T00:00:00.000Z",
            pages_done: 1,
            pages_total: 3,
          },
        ],
      });
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/scans?from=2026-08-01T00%3A00%3A00.000Z&live=true"),
      );
      const body = await jsonBody<{ items: Array<{ urlHash: string }> }>(response);
      expect(body.items[0]?.urlHash).toBe("abcdef123456");
      expect(JSON.stringify(body)).not.toContain("https://");
      expect(db.preparedCalls[0]?.sql).not.toMatch(/s\.url(?:\s|,)/);
    });

    it("returns aggregate-only scan detail without report token", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT id, url_hash, jurisdiction",
        firstReturn: {
          id: "scan-1",
          url_hash: "abcdef1234567890",
          jurisdiction: "VN",
          category: "online_game",
          state: "completed",
          coverage_json: JSON.stringify({
            fetched: ["https://secret.example/"],
            failed: [],
            skipped: [],
          }),
          analysis_version: "v1",
          created_at: "2026-08-05T00:00:00.000Z",
          expires_at: "2026-08-12T00:00:00.000Z",
        },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT state, COUNT(*) AS count FROM scan_pages",
        firstReturn: null,
        allReturn: [{ state: "fetched", count: 1 }],
      });
      db.rows.push({
        sql: "SELECT severity, COUNT(*) AS count FROM findings",
        firstReturn: null,
        allReturn: [{ severity: "pass", count: 2 }],
      });
      db.rows.push({ sql: "SELECT model_id, prompt_version", firstReturn: null, allReturn: [] });
      db.rows.push({
        sql: "SELECT scan_id, token_hash IS NOT NULL",
        firstReturn: {
          scan_id: "scan-1",
          available: 1,
          expires_at: "2026-08-12T00:00:00.000Z",
          token_hash: "never-return",
        },
        allReturn: [],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/scans/scan-1"));
      const text = await response.text();
      expect(text).not.toContain("secret.example");
      expect(text).not.toContain("never-return");
    const body = JSON.parse(text) as { coverage: { fetched: number } };
    expect(body.coverage.fetched).toBe(1);
    });
  });

  describe("GET /v1/admin/metrics/compliance", () => {
    it("returns rubric-ordered totals and category median", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT f.severity, s.category, COUNT(*) AS count",
        firstReturn: null,
        allReturn: [
          { severity: "pass", category: "online_game", count: 1 },
          { severity: "review", category: "online_game", count: 2 },
          { severity: "high", category: "online_game", count: 1 },
        ],
      });
      db.rows.push({
        sql: "SELECT ar.rule_version_id",
        firstReturn: {
          rule_version_id: "vn-mvp-v1",
          prompt_version: "p1",
          retrieval_version: "r1",
        },
        allReturn: [],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/metrics/compliance"));
      const body = await jsonBody<{
        severityOrder: string[];
        totals: Record<string, number>;
        categories: Array<{ medianSeverity: string }>;
      }>(response);
      expect(body.severityOrder).toEqual(["pass", "review", "high"]);
      expect(body.totals.review).toBe(2);
      expect(body.categories[0]?.medianSeverity).toBe("review");
    });
  });

  describe("GET /v1/admin/health", () => {
    it("returns D1 aggregates and explicit unknown sections without leaking details", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT\n      (SELECT COUNT(*) FROM scans)",
        firstReturn: {
          scans: 4,
          reports: 2,
          legal_documents: 3,
          review_events: 1,
          oldest_active_scan: null,
          oldest_pending_review: null,
        },
        allReturn: [],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/health"));
      const body = await jsonBody<{
        sections: Record<
          string,
          { status: string; reason?: string; metrics?: Record<string, unknown> }
        >;
      }>(response);
      expect(body.sections.d1?.metrics?.scans).toBe(4);
      expect(body.sections.queue).toMatchObject({
        status: "unknown",
        reason: "analytics_not_configured",
      });
      expect(JSON.stringify(body)).not.toContain("SELECT");
    });
  });

  describe("GET /v1/admin/metrics/usage", () => {
    it("returns current, previous, deltas, and hash completeness", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT\n      (SELECT COUNT(*) FROM scans",
        firstReturn: {
          scans_current: 12,
          scans_previous: 9,
          sites_current: 7,
          sites_previous: 8,
          reports_current: 5,
          reports_previous: 2,
          reviewers_current: 3,
          reviewers_previous: 1,
          unhashed_current: 1,
        },
        allReturn: [],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/metrics/usage"));
      expect(response.status).toBe(200);
      const body = await jsonBody<{
        scans: { delta: number };
        uniqueSites: { delta: number };
        uniqueSitesComplete: boolean;
      }>(response);
      expect(body.scans.delta).toBe(3);
      expect(body.uniqueSites.delta).toBe(-1);
      expect(body.uniqueSitesComplete).toBe(false);
      expect(db.preparedCalls[0]?.bindings).toHaveLength(18);
    });
  });

  describe("GET /v1/admin/audit", () => {
    it("returns normalized events and a stable next cursor", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT e.id, e.document_id, e.actor, e.decision, e.reason, e.created_at",
        firstReturn: null,
        allReturn: Array.from({ length: 51 }, (_, index) => ({
          id: `evt-${String(index).padStart(2, "0")}`,
          document_id: `doc-${index}`,
          actor: "reviewer@safelaunch.test",
          decision: index === 0 ? "approve" : "rejected",
          reason: `Reason ${index}`,
          created_at: new Date(Date.UTC(2026, 7, 5, 12, 0, 0) - index * 1_000).toISOString(),
          document_title: index === 0 ? "Test law" : null,
          jurisdiction: index === 0 ? "VN" : null,
        })),
      });
      const response = await runWithDb(
        db,
        new Request(
          "http://local/v1/admin/audit?from=2026-08-01T00%3A00%3A00.000Z&actor=reviewer%40safelaunch.test&decision=approved",
        ),
      );
      expect(response.status).toBe(200);
      const body = await jsonBody<{
        items: Array<{ decision: string; documentTitle: string | null }>;
        nextCursor: string | null;
        window: { from: string; to: string | null };
      }>(response);
      expect(body.items).toHaveLength(50);
      expect(body.items[0]).toMatchObject({ decision: "approved", documentTitle: "Test law" });
      expect(body.nextCursor).toBeTypeOf("string");
      expect(body.window).toEqual({ from: "2026-08-01T00:00:00.000Z", to: null });
      expect(db.preparedCalls[0]?.bindings).toEqual([
        "2026-08-01T00:00:00.000Z",
        "reviewer@safelaunch.test",
        "approved",
        "approve",
        51,
      ]);
    });

    it("rejects invalid filters and cursors", async () => {
      const db = new FakeD1();
      const badDecision = await runWithDb(
        db,
        new Request("http://local/v1/admin/audit?decision=delete"),
      );
      expect(badDecision.status).toBe(400);
      const badCursor = await runWithDb(
        db,
        new Request("http://local/v1/admin/audit?cursor=not-a-cursor"),
      );
      expect(badCursor.status).toBe(400);
      expect(db.preparedCalls).toHaveLength(0);
    });
  });

  describe("GET /v1/admin/legal/pending", () => {
    it("returns pending documents mapped to camelCase", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT id, jurisdiction, source_url, title, retrieved_at, source_hash, effective_from, effective_to FROM legal_documents WHERE status = 'pending_review' ORDER BY retrieved_at DESC LIMIT 100",
        firstReturn: null,
        allReturn: [
          {
            id: "doc-1",
            jurisdiction: "VN",
            source_url: "https://vbpl.vn/doc-1",
            title: "Test law",
            retrieved_at: "2026-07-29T00:00:00.000Z",
            source_hash: "hash-1",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/legal/pending"));
      expect(response.status).toBe(200);
      const body =
        await jsonBody<Array<{ id: string; sourceUrl: string; effectiveFrom: string | null }>>(
          response,
        );
      expect(body).toHaveLength(1);
      expect(body[0]?.id).toBe("doc-1");
      expect(body[0]?.sourceUrl).toBe("https://vbpl.vn/doc-1");
      expect(body[0]?.effectiveFrom).toBe("2026-01-01");
    });
  });

  describe("GET /v1/admin/legal/:documentId", () => {
    it("returns 404 for missing documents", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT id, jurisdiction, source_url, title, retrieved_at, source_hash, effective_from, effective_to FROM legal_documents WHERE id = ?",
        firstReturn: null,
        allReturn: [],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/legal/missing"));
      expect(response.status).toBe(404);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("returns 400 for invalid document id", async () => {
      const db = new FakeD1();
      const longId = "x".repeat(300);
      const response = await runWithDb(db, new Request(`http://local/v1/admin/legal/${longId}`));
      expect(response.status).toBe(400);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("INVALID_DOCUMENT_ID");
    });

    it("returns full document with provisions, relations, audit", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT id, jurisdiction, source_url, title, retrieved_at, source_hash, effective_from, effective_to FROM legal_documents WHERE id = ?",
        firstReturn: {
          id: "doc-1",
          jurisdiction: "VN",
          source_url: "https://vbpl.vn/doc-1",
          title: "Test",
          retrieved_at: "2026-07-29T00:00:00.000Z",
          source_hash: "h",
          effective_from: null,
          effective_to: null,
        },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT id, document_id, article, clause, text, categories_json FROM legal_provisions WHERE document_id = ?",
        firstReturn: null,
        allReturn: [
          {
            id: "p-1",
            document_id: "doc-1",
            article: "1",
            clause: null,
            text: "Provision text",
            categories_json: '["online_game","electronic_press"]',
          },
        ],
      });
      db.rows.push({
        sql: "SELECT id, from_document_id, to_document_id, relation_type FROM document_relations WHERE from_document_id = ?",
        firstReturn: null,
        allReturn: [
          {
            id: "r-1",
            from_document_id: "doc-1",
            to_document_id: "doc-2",
            relation_type: "amends",
          },
        ],
      });
      db.rows.push({
        sql: "SELECT actor, decision, reason, created_at FROM legal_review_events WHERE document_id = ? ORDER BY created_at DESC LIMIT 50",
        firstReturn: null,
        allReturn: [
          {
            actor: "reviewer-a@safelaunch.test",
            decision: "approved",
            reason: "Looks good",
            created_at: "2026-07-29T01:00:00.000Z",
          },
        ],
      });
      const response = await runWithDb(db, new Request("http://local/v1/admin/legal/doc-1"));
      expect(response.status).toBe(200);
      const body = await jsonBody<{
        id: string;
        provisions: Array<{ id: string; categories: string[] }>;
        relations: Array<{ id: string; type: string; targetDocumentId: string }>;
        audit: Array<{ actor: string; decision: string }>;
      }>(response);
      expect(body.id).toBe("doc-1");
      expect(body.provisions).toHaveLength(1);
      expect(body.provisions[0]?.categories).toEqual(["online_game", "electronic_press"]);
      expect(body.relations).toHaveLength(1);
      expect(body.relations[0]?.type).toBe("amends");
      expect(body.relations[0]?.targetDocumentId).toBe("doc-2");
      expect(body.audit[0]?.actor).toBe("reviewer-a@safelaunch.test");
    });
  });

  describe("POST /v1/admin/legal/:documentId/review", () => {
    it("approves a pending document and inserts audit event", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT status FROM legal_documents WHERE id = ?",
        firstReturn: { status: "pending_review" },
        allReturn: [],
      });
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/legal/doc-1/review", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-access-authenticated-user-email": "reviewer@safelaunch.test",
          },
          body: JSON.stringify({ decision: "approve", reason: "All checks pass" }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await jsonBody<{
        ok: boolean;
        status: string;
        actor: string;
        eventId: string;
      }>(response);
      expect(body.ok).toBe(true);
      expect(body.status).toBe("approved");
      expect(body.actor).toBe("reviewer@safelaunch.test");
      expect(body.eventId).toMatch(/^evt_/);
      expect(db.batchCalls).toHaveLength(1);
    });

    it("rejects a document", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT status FROM legal_documents WHERE id = ?",
        firstReturn: { status: "pending_review" },
        allReturn: [],
      });
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/legal/doc-1/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "reject", reason: "Wrong scope" }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await jsonBody<{ status: string }>(response);
      expect(body.status).toBe("rejected");
    });

    it("returns 409 if the document was already reviewed", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT status FROM legal_documents WHERE id = ?",
        firstReturn: { status: "approved" },
        allReturn: [],
      });
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/legal/doc-1/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "approve", reason: "Looks fine" }),
        }),
      );
      expect(response.status).toBe(409);
      const body = await jsonBody<{ code: string; currentStatus: string }>(response);
      expect(body.code).toBe("ALREADY_REVIEWED");
      expect(body.currentStatus).toBe("approved");
    });

    it("returns 400 for invalid decision", async () => {
      const db = new FakeD1();
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/legal/doc-1/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "maybe", reason: "unsure" }),
        }),
      );
      expect(response.status).toBe(400);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("INVALID_DECISION");
    });

    it("returns 400 for short reason", async () => {
      const db = new FakeD1();
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/legal/doc-1/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "approve", reason: "x" }),
        }),
      );
      expect(response.status).toBe(400);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("INVALID_REASON");
    });

    it("returns 400 for invalid JSON", async () => {
      const db = new FakeD1();
      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/legal/doc-1/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        }),
      );
      expect(response.status).toBe(400);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("INVALID_JSON");
    });
  });
});
