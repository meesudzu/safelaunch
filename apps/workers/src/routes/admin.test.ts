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
        const row = this.rows.find((entry) => entry.sql === sql);
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
  describe("GET /v1/admin/metrics/usage", () => {
    it("returns 24h usage metrics without exposing raw URLs", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT COUNT(*) AS scans FROM scans WHERE created_at >= ?",
        firstReturn: { scans: 6 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(*) AS scans FROM scans WHERE created_at >= ? AND created_at < ?",
        firstReturn: { scans: 4 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(DISTINCT url_hash) AS sites FROM scans WHERE created_at >= ? AND url_hash IS NOT NULL",
        firstReturn: { sites: 3 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(*) AS reports FROM reports r JOIN scans s ON s.id = r.scan_id WHERE r.expires_at > ? AND s.created_at >= ?",
        firstReturn: { reports: 2 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(DISTINCT actor) AS reviewers FROM legal_review_events WHERE created_at >= ?",
        firstReturn: { reviewers: 1 },
        allReturn: [],
      });

      const response = await runWithDb(db, new Request("http://local/v1/admin/metrics/usage"));

      expect(response.status).toBe(200);
      const body = await jsonBody<{
        windowHours: number;
        tiles: Array<{ key: string; label: string; value: number; delta?: number }>;
      }>(response);
      expect(body.windowHours).toBe(24);
      expect(body.tiles).toEqual([
        { key: "scans24h", label: "Scans in last 24h", value: 6, delta: 2 },
        { key: "uniqueSites24h", label: "Unique sites scanned", value: 3 },
        { key: "reportsOpened24h", label: "Reports opened", value: 2 },
        { key: "activeReviewers24h", label: "Active reviewers", value: 1 },
      ]);
      expect(JSON.stringify(body)).not.toContain("https://");
    });
  });

  describe("GET /v1/admin/scans", () => {
    it("lists scan statuses with page counts and truncated url hashes", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT s.id, s.created_at, s.jurisdiction, s.category, s.state, s.expires_at, s.url_hash, COUNT(p.id) AS total_pages, SUM(CASE WHEN p.state = 'completed' THEN 1 ELSE 0 END) AS pages_done FROM scans s LEFT JOIN scan_pages p ON p.scan_id = s.id WHERE s.state NOT IN ('completed','failed','partial') AND s.created_at >= ? GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
        firstReturn: null,
        allReturn: [
          {
            id: "scan_1",
            created_at: "2026-08-06T01:00:00.000Z",
            jurisdiction: "VN",
            category: "online_game",
            state: "evaluating",
            expires_at: "2026-08-13T01:00:00.000Z",
            url_hash: "abcdef1234567890",
            total_pages: 3,
            pages_done: 2,
          },
        ],
      });

      const response = await runWithDb(db, new Request("http://local/v1/admin/scans"));

      expect(response.status).toBe(200);
      const body = await jsonBody<{
        scans: Array<{
          scanId: string;
          urlHashPrefix: string;
          pagesDone: number;
          totalPages: number;
        }>;
        live: boolean;
      }>(response);
      expect(body.live).toBe(true);
      expect(body.scans).toEqual([
        {
          scanId: "scan_1",
          createdAt: "2026-08-06T01:00:00.000Z",
          jurisdiction: "VN",
          category: "online_game",
          state: "evaluating",
          expiresAt: "2026-08-13T01:00:00.000Z",
          urlHashPrefix: "abcdef123456",
          pagesDone: 2,
          totalPages: 3,
        },
      ]);
      expect(JSON.stringify(body)).not.toContain("https://");
    });
  });

  describe("GET /v1/admin/scans/:scanId", () => {
    it("returns scan detail with coverage, severity counts, analysis runs, and report link", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT id, created_at, jurisdiction, category, state, expires_at, url_hash, coverage_json FROM scans WHERE id = ?",
        firstReturn: {
          id: "scan_1",
          created_at: "2026-08-06T01:00:00.000Z",
          jurisdiction: "VN",
          category: "online_game",
          state: "completed",
          expires_at: "2099-08-13T01:00:00.000Z",
          url_hash: "abcdef1234567890",
          coverage_json: '{"fetched":["homepage"],"failed":[],"skipped":["terms"]}',
        },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT severity, COUNT(*) AS n FROM findings WHERE scan_id = ? GROUP BY severity",
        firstReturn: null,
        allReturn: [{ severity: "high", n: 2 }],
      });
      db.rows.push({
        sql: "SELECT model_id, prompt_version, retrieval_version, created_at FROM analysis_runs WHERE scan_id = ? ORDER BY created_at DESC",
        firstReturn: null,
        allReturn: [
          {
            model_id: "@cf/meta/llama",
            prompt_version: "p1",
            retrieval_version: "r1",
            created_at: "2026-08-06T01:30:00.000Z",
          },
        ],
      });
      db.rows.push({
        sql: "SELECT payload_json, expires_at FROM reports WHERE scan_id = ? AND expires_at > ?",
        firstReturn: {
          payload_json: '{"_reportToken":"tok_1"}',
          expires_at: "2099-08-13T01:00:00.000Z",
        },
        allReturn: [],
      });

      const response = await runWithDb(db, new Request("http://local/v1/admin/scans/scan_1"));

      expect(response.status).toBe(200);
      const body = await jsonBody<{
        scanId: string;
        urlHashPrefix: string;
        reportUrl: string | null;
        severityCounts: Record<string, number>;
      }>(response);
      expect(body.scanId).toBe("scan_1");
      expect(body.urlHashPrefix).toBe("abcdef123456");
      expect(body.severityCounts).toEqual({ high: 2, review: 0, pass: 0 });
      expect(body.reportUrl).toBe("/vi/report/tok_1");
      expect(JSON.stringify(body)).not.toContain("https://");
    });
  });

  describe("GET /v1/admin/redeem", () => {
    it("returns redeem inventory tiles and batch rows without plaintext codes", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT COUNT(*) AS issued FROM redeem_codes",
        firstReturn: { issued: 10 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(*) AS issued FROM redeem_codes WHERE created_at >= ?",
        firstReturn: { issued: 4 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(DISTINCT code_id) AS redeemed FROM redeem_grants",
        firstReturn: { redeemed: 6 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(DISTINCT code_id) AS redeemed FROM redeem_grants WHERE granted_at >= ?",
        firstReturn: { redeemed: 2 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT COUNT(*) AS expiring FROM redeem_codes c WHERE c.expires_at < ? AND c.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM redeem_grants g WHERE g.code_id = c.id)",
        firstReturn: { expiring: 1 },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT c.label AS batch_id, MIN(c.created_at) AS issued_at, c.created_by AS issued_by, COUNT(*) AS total, COUNT(DISTINCT g.code_id) AS redeemed, SUM(CASE WHEN c.expires_at < ? AND g.code_id IS NULL THEN 1 ELSE 0 END) AS expired, SUM(CASE WHEN c.expires_at >= ? AND g.code_id IS NULL AND c.revoked_at IS NULL THEN 1 ELSE 0 END) AS unused FROM redeem_codes c LEFT JOIN redeem_grants g ON g.code_id = c.id GROUP BY c.label, c.created_by ORDER BY issued_at DESC LIMIT 100",
        firstReturn: null,
        allReturn: [
          {
            batch_id: "Q3 marketing campaign",
            issued_at: "2026-08-01T00:00:00.000Z",
            issued_by: "ops@safelaunch.app",
            total: 10,
            redeemed: 6,
            expired: 1,
            unused: 3,
          },
        ],
      });

      const response = await runWithDb(db, new Request("http://local/v1/admin/redeem"));

      expect(response.status).toBe(200);
      const body = await jsonBody<{
        tiles: Array<{ key: string; value: number; secondaryValue?: number }>;
        batches: Array<{ batchId: string; unused: number }>;
      }>(response);
      expect(body.tiles).toEqual([
        { key: "issued", label: "Codes issued", value: 10, secondaryValue: 4 },
        { key: "redeemed", label: "Codes redeemed", value: 6, secondaryValue: 2 },
        { key: "redemptionRate", label: "Redemption rate", value: 60 },
        { key: "expiringSoon", label: "Expiring soon", value: 1 },
      ]);
      expect(body.batches[0]).toMatchObject({ batchId: "Q3 marketing campaign", unused: 3 });
      expect(JSON.stringify(body)).not.toContain("SL-");
      expect(JSON.stringify(body)).not.toContain("code_hash");
    });
  });

  describe("POST /v1/admin/redeem/generate", () => {
    it("generates plaintext codes once for a batch", async () => {
      const db = new FakeD1();

      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/redeem/generate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-access-authenticated-user-email": "ops@safelaunch.app",
          },
          body: JSON.stringify({
            batchId: "Q3 marketing campaign",
            count: 2,
            expiresAt: "2026-09-01T00:00:00.000Z",
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await jsonBody<{ codes: string[]; batchId: string }>(response);
      expect(body.batchId).toBe("Q3 marketing campaign");
      expect(body.codes).toHaveLength(2);
      expect(body.codes[0]).toMatch(/^SL-/);
      expect(
        db.preparedCalls.filter((call) => call.sql.includes("INSERT INTO redeem_codes")),
      ).toHaveLength(2);
    });
  });

  describe("GET /v1/admin/health", () => {
    it("returns D1 row counts and retention health without raw scan URLs", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT 'scans' AS table_name, COUNT(*) AS rows FROM scans UNION ALL SELECT 'legal_documents', COUNT(*) FROM legal_documents UNION ALL SELECT 'legal_review_events', COUNT(*) FROM legal_review_events",
        firstReturn: null,
        allReturn: [
          { table_name: "scans", rows: 12 },
          { table_name: "legal_documents", rows: 4 },
          { table_name: "legal_review_events", rows: 7 },
        ],
      });
      db.rows.push({
        sql: "SELECT MIN(created_at) AS oldest_scan, MIN(expires_at) AS next_purge FROM scans WHERE expires_at > datetime('now')",
        firstReturn: {
          oldest_scan: "2026-08-01T00:00:00.000Z",
          next_purge: "2026-08-08T00:00:00.000Z",
        },
        allReturn: [],
      });
      db.rows.push({
        sql: "SELECT MIN(created_at) AS oldest_pending_review FROM legal_documents WHERE status = 'pending_review'",
        firstReturn: { oldest_pending_review: "2026-08-02T00:00:00.000Z" },
        allReturn: [],
      });

      const response = await runWithDb(db, new Request("http://local/v1/admin/health"));

      expect(response.status).toBe(200);
      const body = await jsonBody<{
        d1: {
          rowCounts: Array<{ tableName: string; rows: number }>;
          retention: { oldestScan: string | null; nextPurge: string | null };
          oldestPendingReview: string | null;
        };
        bindings: Array<{ name: string; status: string }>;
      }>(response);
      expect(body.d1.rowCounts).toEqual([
        { tableName: "scans", rows: 12 },
        { tableName: "legal_documents", rows: 4 },
        { tableName: "legal_review_events", rows: 7 },
      ]);
      expect(body.d1.retention.nextPurge).toBe("2026-08-08T00:00:00.000Z");
      expect(body.d1.oldestPendingReview).toBe("2026-08-02T00:00:00.000Z");
      expect(body.bindings).toContainEqual({ name: "ARTIFACTS", status: "missing" });
      expect(JSON.stringify(body)).not.toContain("https://");
    });
  });

  describe("GET /v1/admin/audit", () => {
    it("lists review events with default pagination and date filters", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT e.id, e.created_at, e.actor, e.decision, e.reason, d.title AS document_title, d.jurisdiction FROM legal_review_events e LEFT JOIN legal_documents d ON d.id = e.document_id WHERE e.created_at >= ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?",
        firstReturn: null,
        allReturn: [
          {
            id: "evt-2",
            created_at: "2026-08-05T02:00:00.000Z",
            actor: "reviewer@safelaunch.app",
            decision: "approve",
            reason: "Đủ căn cứ",
            document_title: "Nghị định kiểm thử",
            jurisdiction: "VN",
          },
        ],
      });

      const response = await runWithDb(db, new Request("http://local/v1/admin/audit"));

      expect(response.status).toBe(200);
      const body = await jsonBody<{
        events: Array<{
          id: string;
          createdAt: string;
          actor: string;
          documentTitle: string;
          jurisdiction: string;
          decision: string;
          reason: string;
        }>;
        nextCursor: string | null;
        summary: { total: number; approved: number; rejected: number; pending: number };
      }>(response);
      expect(body.events).toEqual([
        {
          id: "evt-2",
          createdAt: "2026-08-05T02:00:00.000Z",
          actor: "reviewer@safelaunch.app",
          documentTitle: "Nghị định kiểm thử",
          jurisdiction: "VN",
          decision: "approved",
          reason: "Đủ căn cứ",
        },
      ]);
      expect(body.nextCursor).toBeNull();
      expect(body.summary).toEqual({ total: 1, approved: 1, rejected: 0, pending: 0 });
      expect(db.preparedCalls[0]?.bindings).toHaveLength(2);
      expect(typeof db.preparedCalls[0]?.bindings[0]).toBe("string");
      expect(db.preparedCalls[0]?.bindings[1]).toBe(51);
    });

    it("applies actor, decision, date, and cursor filters", async () => {
      const db = new FakeD1();
      db.rows.push({
        sql: "SELECT e.id, e.created_at, e.actor, e.decision, e.reason, d.title AS document_title, d.jurisdiction FROM legal_review_events e LEFT JOIN legal_documents d ON d.id = e.document_id WHERE e.created_at >= ? AND e.created_at <= ? AND e.actor = ? AND e.decision = ? AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?)) ORDER BY e.created_at DESC, e.id DESC LIMIT ?",
        firstReturn: null,
        allReturn: [],
      });

      const cursor = Buffer.from(
        JSON.stringify({ createdAt: "2026-08-04T02:00:00.000Z", id: "evt-3" }),
      ).toString("base64url");
      const response = await runWithDb(
        db,
        new Request(
          `http://local/v1/admin/audit?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-05T00%3A00%3A00.000Z&actor=reviewer%40safelaunch.app&decision=rejected&cursor=${cursor}&limit=10`,
        ),
      );

      expect(response.status).toBe(200);
      expect(db.preparedCalls[0]?.bindings).toEqual([
        "2026-08-01T00:00:00.000Z",
        "2026-08-05T00:00:00.000Z",
        "reviewer@safelaunch.app",
        "reject",
        "2026-08-04T02:00:00.000Z",
        "2026-08-04T02:00:00.000Z",
        "evt-3",
        11,
      ]);
    });

    it("rejects malformed date filters before querying D1", async () => {
      const db = new FakeD1();

      const response = await runWithDb(
        db,
        new Request("http://local/v1/admin/audit?from=not-a-date"),
      );

      expect(response.status).toBe(400);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("INVALID_DATE");
      expect(db.preparedCalls).toHaveLength(0);
    });

    it("rejects cursors with malformed timestamps", async () => {
      const db = new FakeD1();
      const cursor = Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: "evt-3" })).toString(
        "base64url",
      );

      const response = await runWithDb(
        db,
        new Request(`http://local/v1/admin/audit?cursor=${cursor}`),
      );

      expect(response.status).toBe(400);
      const body = await jsonBody<{ code: string }>(response);
      expect(body.code).toBe("INVALID_CURSOR");
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
