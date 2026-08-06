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
