import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { adminRedeemCodesRouter } from "./admin-redeem-codes";

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

interface RedeemCodeRow {
  id: string;
  code_hash: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface GrantRow {
  id: string;
  code_id: string;
  domain_key: string;
  quota_day: string;
  granted_at: string;
}

const jsonBody = async <T>(response: Response): Promise<T> =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  (await response.json()) as T;

class FakeD1 {
  rows: Array<{ sql: string; firstReturn: unknown; allReturn: unknown[] }> = [];
  preparedCalls: QueryCall[] = [];

  prepare(sql: string) {
    const stmt = {
      bind: (...bindings: unknown[]) => {
        this.preparedCalls.push({ sql, bindings });
        const row = this.rows.find((entry) => entry.sql === sql);
        const first = row?.firstReturn ?? null;
        const all = row?.allReturn ?? [];
        return {
          first: <T>(): Promise<T | null> => Promise.resolve(first as T | null),
          all: <T>(): Promise<{ results: T[]; success: boolean; meta: unknown }> =>
            Promise.resolve({ results: all as T[], success: true, meta: {} }),
          run: (): Promise<{ results: unknown[]; success: boolean; meta: unknown }> =>
            Promise.resolve({ results: [], success: true, meta: {} }),
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  }
  batch(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  exec(): Promise<D1ExecResult> {
    return Promise.resolve({ count: 0, duration: 0 });
  }
  withSession(): D1DatabaseSession {
    return {} as D1DatabaseSession;
  }
  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

const buildApp = () => {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.route("/v1/admin", adminRedeemCodesRouter);
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
    const body = await jsonBody<{ code: string; codeHashPrefix: string; createdBy: string }>(res);
    expect(body.code).toMatch(
      /^SL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,
    );
    expect(body.codeHashPrefix).toMatch(/^[0-9a-f]{8}$/);
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
    const row: RedeemCodeRow = {
      id: "rc_1",
      code_hash: "x".repeat(64),
      label: "Pilot",
      created_by: "reviewer@safelaunch.app",
      created_at: "2026-08-03T00:00:00.000Z",
      expires_at: "2026-09-01T00:00:00.000Z",
      revoked_at: null,
    };
    db.rows.push({
      sql: "SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT ? OFFSET ?",
      firstReturn: null,
      allReturn: [row],
    });
    const res = await runWithDb(db, new Request("https://example/v1/admin/redeem-codes"));
    const body = await jsonBody<Array<{ id: string; label: string }>>(res);
    const json = JSON.stringify(body);
    expect(json).not.toContain("x".repeat(64));
    expect(json).not.toContain("code_hash");
    expect(json).toContain("rc_1");
    expect(json).toContain("Pilot");
  });

  it("DELETE soft-revokes", async () => {
    const db = new FakeD1();
    const res = await runWithDb(
      db,
      new Request("https://example/v1/admin/redeem-codes/rc_1", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const updateCall = db.preparedCalls.some(
      (c) => c.sql.includes("UPDATE") && c.sql.includes("revoked_at"),
    );
    expect(updateCall).toBe(true);
  });

  it("GET /:id/grants returns grant rows", async () => {
    const db = new FakeD1();
    const row: GrantRow = {
      id: "rg_1",
      code_id: "rc_1",
      domain_key: "example.com",
      quota_day: "2026-08-03",
      granted_at: "2026-08-03T10:00:00.000Z",
    };
    db.rows.push({
      sql: "SELECT * FROM redeem_grants WHERE code_id = ? ORDER BY granted_at DESC",
      firstReturn: null,
      allReturn: [row],
    });
    const res = await runWithDb(
      db,
      new Request("https://example/v1/admin/redeem-codes/rc_1/grants"),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<Array<{ domainKey: string }>>(res);
    expect(body[0]?.domainKey).toBe("example.com");
  });
});
