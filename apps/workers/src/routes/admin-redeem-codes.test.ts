import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { adminRedeemCodesRouter } from "./admin-redeem-codes";

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

class FakeD1 {
  rows: Array<{ sql: string; firstReturn: unknown; allReturn: unknown[] }> = [];
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
          first: async <T>(): Promise<T | null> => (first as T | null),
          all: async <T>(): Promise<{ results: T[]; success: boolean; meta: unknown }> => ({
            results: all as T[], success: true, meta: {},
          }),
          run: async () => ({ results: [], success: true, meta: {} }),
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  }
  async batch() { return []; }
  exec() { return Promise.resolve({ count: 0, duration: 0 }); }
  withSession(): D1DatabaseSession { return {} as D1DatabaseSession; }
  async dump() { return new ArrayBuffer(0); }
}

const buildApp = () => {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.route("/", adminRedeemCodesRouter);
  return app;
};

const runWithDb = (db: FakeD1, request: Request) =>
  buildApp().fetch(request, { DB: db as unknown as D1Database });

describe("admin redeem codes router", () => {
  it("POST creates a code and returns plaintext once", async () => {
    const db = new FakeD1();
    const res = await runWithDb(
      db,
      new Request("https://example/v1/admin/redeem-codes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-access-authenticated-user-email": "reviewer@safelaunch.app",
        },
        body: JSON.stringify({ label: "Pilot", expiresAt: "2026-09-01T00:00:00.000Z" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.code).toMatch(/^SL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(body.codeHashPrefix).toMatch(/^[0-9a-f]{8}$/);
    expect(body.codeHashPrefix.length).toBe(8);
    expect(body.createdBy).toBe("reviewer@safelaunch.app");
  });

  it("POST rejects invalid body", async () => {
    const db = new FakeD1();
    const res = await runWithDb(
      db,
      new Request("https://example/v1/admin/redeem-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("GET does not include plaintext or code_hash", async () => {
    const db = new FakeD1();
    db.rows.push({
      sql: "SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT ? OFFSET ?",
      firstReturn: null,
      allReturn: [{
        id: "rc_1", code_hash: "x".repeat(64), label: "Pilot",
        created_by: "reviewer@safelaunch.app", created_at: "2026-08-03T00:00:00.000Z",
        expires_at: "2026-09-01T00:00:00.000Z", revoked_at: null,
      }],
    });
    const res = await runWithDb(db, new Request("https://example/v1/admin/redeem-codes"));
    const body = (await res.json()) as any;
    const json = JSON.stringify(body);
    expect(json).not.toContain("x".repeat(64));
    expect(json).not.toContain("code_hash");
    expect(json).toContain("rc_1");
    expect(json).toContain("Pilot");
  });

  it("DELETE soft-revokes", async () => {
    const db = new FakeD1();
    const res = await runWithDb(db, new Request("https://example/v1/admin/redeem-codes/rc_1", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const updateCall = db.preparedCalls.some((c) => c.sql.includes("UPDATE") && c.sql.includes("revoked_at"));
    expect(updateCall).toBe(true);
  });

  it("GET /:id/grants returns grant rows", async () => {
    const db = new FakeD1();
    db.rows.push({
      sql: "SELECT * FROM redeem_grants WHERE code_id = ? ORDER BY granted_at DESC",
      firstReturn: null,
      allReturn: [{
        id: "rg_1", code_id: "rc_1", domain_key: "example.com",
        quota_day: "2026-08-03", granted_at: "2026-08-03T10:00:00.000Z",
      }],
    });
    const res = await runWithDb(db, new Request("https://example/v1/admin/redeem-codes/rc_1/grants"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body[0].domainKey).toBe("example.com");
  });
});
