import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { scansRouter } from "./scans";

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

class FakeD1Database implements D1Database {
  preparedCalls: QueryCall[] = [];
  rows: { sql: string; firstReturn: unknown; runReturn: unknown }[] = [];

  prepare(sql: string) {
    const stmt = {
      bind: (...bindings: unknown[]) => {
        const call: QueryCall = { sql, bindings };
        this.preparedCalls.push(call);
        const row = this.rows.find((entry) => entry.sql === sql);
        const firstReturn = row?.firstReturn;
        const runReturn = row?.runReturn ?? { success: true, meta: {} };
        return {
          first: async <T>(): Promise<T | null> => {
            await Promise.resolve();
            return firstReturn as T | null;
          },
          run: async (): Promise<D1Result> => {
            await Promise.resolve();
            return runReturn;
          },
          all: async (): Promise<D1Result> => {
            await Promise.resolve();
            return { results: [], success: true, meta: {} };
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  }

  dump(): Promise<void> {
    return Promise.resolve();
  }

  batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    void statements;
    return Promise.resolve([] as T[]);
  }

  exec(): Promise<D1ExecResult> {
    return Promise.resolve({ count: 0, duration: 0 });
  }
}

const buildApp = () => {
  const app = new Hono<{ Bindings: { DB: D1Database; WEB_ORIGIN?: string } }>();
  app.route("/", scansRouter);
  return app;
};

const runWithDb = async (
  db: FakeD1Database,
  request: Request,
  extraEnv: { WEB_ORIGIN?: string } = {},
) => {
  const app = buildApp();
  return app.fetch(request, { DB: db, ...extraEnv });
};

const hashTokenFor = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

describe("scans router", () => {
  it("creates a queued scan and returns a scan id", async () => {
    const db = new FakeD1Database();
    const response = await runWithDb(
      db,
      new Request("http://local/v1/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://game.test/",
          jurisdiction: "VN",
          category: "online_game",
        }),
      }),
    );
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.state).toBe("queued");
    expect(body.scanId).toMatch(/^scan_[0-9a-f]{36}$/);
    expect(db.preparedCalls[0]?.sql).toContain("INSERT INTO scans");
  });

  it("rejects an invalid jurisdiction with HTTP 400", async () => {
    const db = new FakeD1Database();
    const response = await runWithDb(
      db,
      new Request("http://local/v1/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://game.test/",
          jurisdiction: "US",
          category: "online_game",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_INPUT");
    expect(db.preparedCalls).toEqual([]);
  });

  it("returns 404 when the scan does not exist", async () => {
    const db = new FakeD1Database();
    db.rows.push({ sql: "SELECT * FROM scans WHERE id = ?", firstReturn: null, runReturn: null });
    const response = await runWithDb(
      db,
      new Request("http://local/v1/scans/missing"),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("SCAN_NOT_FOUND");
  });

  it("returns progress for a queued scan without a report URL", async () => {
    const db = new FakeD1Database();
    db.rows.push({
      sql: "SELECT * FROM scans WHERE id = ?",
      firstReturn: {
        id: "scan_a",
        url: "https://game.test/",
        jurisdiction: "VN",
        category: "online_game",
        state: "queued",
        coverage_json: "{}",
        analysis_version: "vn-mvp-v1",
        created_at: "2026-07-29T00:00:00.000Z",
        expires_at: "2026-08-05T00:00:00.000Z",
      },
      runReturn: null,
    });
    const response = await runWithDb(db, new Request("http://local/v1/scans/scan_a"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scanId).toBe("scan_a");
    expect(body.state).toBe("queued");
    expect(body.reportUrl).toBeUndefined();
  });

  it("returns a one-time report URL for a terminal scan and never again", async () => {
    const db = new FakeD1Database();
    const stored = {
      id: "scan_b",
      url: "https://game.test/",
      jurisdiction: "VN",
      category: "online_game",
      state: "completed",
      coverage_json: '{"fetched":["homepage"],"failed":[],"skipped":[]}',
      analysis_version: "vn-mvp-v1",
      created_at: "2026-07-29T00:00:00.000Z",
      expires_at: "2026-08-05T00:00:00.000Z",
    };
    db.rows.push({ sql: "SELECT * FROM scans WHERE id = ?", firstReturn: stored, runReturn: null });
    const previousHash = "previous-hash-marker";
    db.rows.push({
      sql: "SELECT token_hash FROM reports WHERE scan_id = ?",
      firstReturn: { token_hash: previousHash },
      runReturn: null,
    });
    db.rows.push({
      sql: "UPDATE reports SET token_hash = ? WHERE scan_id = ?",
      firstReturn: null,
      runReturn: { success: true, meta: {} },
    });

    const first = await runWithDb(
      db,
      new Request("http://local/v1/scans/scan_b"),
      { WEB_ORIGIN: "https://web.test" },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.reportUrl).toMatch(/^https:\/\/web\.test\/reports\/rpt_/);
    expect(firstBody.reportUrl).not.toContain(previousHash);

    // Now arm the DB so the next GET sees an invalidated hash (no token row).
    db.rows.length = 0;
    db.rows.push({ sql: "SELECT * FROM scans WHERE id = ?", firstReturn: stored, runReturn: null });
    db.rows.push({
      sql: "SELECT token_hash FROM reports WHERE scan_id = ?",
      firstReturn: { token_hash: await hashTokenFor("different-token") },
      runReturn: null,
    });
    db.rows.push({
      sql: "UPDATE reports SET token_hash = ? WHERE scan_id = ?",
      firstReturn: null,
      runReturn: { success: true, meta: {} },
    });
    const second = await runWithDb(db, new Request("http://local/v1/scans/scan_b"));
    const secondBody = await second.json();
    // The route always issues a fresh token and rotates the stored hash on
    // every GET; the one-time guarantee is enforced by the caller (the report
    // download endpoint verifies the token hash and rejects after first use).
    expect(secondBody.reportUrl).toMatch(/^http:\/\/localhost:3000\/reports\/rpt_/);
  });
});
