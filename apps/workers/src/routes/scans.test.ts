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
        const runReturn = row?.runReturn ?? {
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0,
          },
          results: [],
        };
        return {
          first: async <T>(): Promise<T | null> => {
            await Promise.resolve();
            return firstReturn as T | null;
          },
          run: async (): Promise<D1Result> => {
            await Promise.resolve();
            return runReturn as D1Result;
          },
          all: async (): Promise<D1Result> => {
            await Promise.resolve();
            return {
              results: [],
              success: true,
              meta: {
                duration: 0,
                size_after: 0,
                rows_read: 0,
                rows_written: 0,
                last_row_id: 0,
                changed_db: false,
                changes: 0,
              },
            };
          },
        };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  }

  async dump(): Promise<ArrayBuffer> {
    await Promise.resolve();
    return new ArrayBuffer(0);
  }

  batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    void statements;
    return Promise.resolve([] as T[]);
  }

  exec(): Promise<D1ExecResult> {
    return Promise.resolve({ count: 0, duration: 0 });
  }
  withSession(): D1DatabaseSession {
    return {} as D1DatabaseSession;
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await response.json()) as {
      code?: string;
      state?: string;
      scanId?: string;
      reportUrl?: string;
    };
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await response.json()) as {
      code?: string;
      state?: string;
      scanId?: string;
      reportUrl?: string;
    };
    expect(body.code).toBe("INVALID_INPUT");
    expect(db.preparedCalls).toEqual([]);
  });

  it("returns 404 when the scan does not exist", async () => {
    const db = new FakeD1Database();
    db.rows.push({ sql: "SELECT * FROM scans WHERE id = ?", firstReturn: null, runReturn: null });
    const response = await runWithDb(db, new Request("http://local/v1/scans/missing"));
    expect(response.status).toBe(404);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    expect(((await response.json()) as { code: string }).code).toBe("SCAN_NOT_FOUND");
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await response.json()) as {
      code?: string;
      state?: string;
      scanId?: string;
      reportUrl?: string;
    };
    expect(body.scanId).toBe("scan_a");
    expect(body.state).toBe("queued");
    expect(body.reportUrl).toBeUndefined();
  });

  it("returns a stable report URL for a terminal scan (no token rotation)", async () => {
    // B5 fix: the token is issued exactly once when the workflow persists
    // the report. /v1/scans/:id must surface that token, NOT regenerate one
    // per poll. Repeated polls return the same URL until /v1/reports/:scanId
    // burns the token_hash (single-use guarantee).
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
    const issuedToken = "rpt_abcdef0123456789abcdef0123456789abcdef0123456789";
    const issuedHash = await hashTokenFor(issuedToken);
    const payloadJson = JSON.stringify({
      scanId: "scan_b",
      state: "completed",
      status: "high_risk",
      findings: [],
      _reportToken: issuedToken,
    });
    db.rows.push({ sql: "SELECT * FROM scans WHERE id = ?", firstReturn: stored, runReturn: null });
    db.rows.push({
      sql: "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
      firstReturn: {
        scan_id: "scan_b",
        token_hash: issuedHash,
        payload_json: payloadJson,
        expires_at: "2026-08-05T00:00:00.000Z",
      },
      runReturn: null,
    });

    const first = await runWithDb(db, new Request("http://local/v1/scans/scan_b"), {
      WEB_ORIGIN: "https://web.test",
    });
    expect(first.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const firstBody = (await first.json()) as { reportUrl?: string };
    expect(firstBody.reportUrl).toBe(`https://web.test/vi/report/${issuedToken}`);

    // Second poll: token_hash is still valid (no rotation, no burn yet).
    // The same URL must be returned.
    db.rows.length = 0;
    db.rows.push({ sql: "SELECT * FROM scans WHERE id = ?", firstReturn: stored, runReturn: null });
    db.rows.push({
      sql: "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
      firstReturn: {
        scan_id: "scan_b",
        token_hash: issuedHash,
        payload_json: payloadJson,
        expires_at: "2026-08-05T00:00:00.000Z",
      },
      runReturn: null,
    });
    const second = await runWithDb(db, new Request("http://local/v1/scans/scan_b"));
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const secondBody = (await second.json()) as { reportUrl?: string };
    expect(secondBody.reportUrl).toBe(`http://localhost:3000/vi/report/${issuedToken}`);
  });

  it("returns no reportUrl once the token_hash has been burned (single-use)", async () => {
    // After /v1/reports/:token is opened once, the route sets token_hash to
    // BURNED_TOKEN_HASH (''). Subsequent polls of /v1/scans/:id must NOT
    // return a URL.
    const db = new FakeD1Database();
    const stored = {
      id: "scan_c",
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
    db.rows.push({
      sql: "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
      firstReturn: {
        scan_id: "scan_c",
        token_hash: "", // already burned (BURNED_TOKEN_HASH)
        payload_json: "{}",
        expires_at: "2026-08-05T00:00:00.000Z",
      },
      runReturn: null,
    });

    const response = await runWithDb(db, new Request("http://local/v1/scans/scan_c"));
    expect(response.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await response.json()) as { reportUrl?: string };
    expect(body.reportUrl).toBeUndefined();
  });

  it("normalizes coverage to the canonical shape even when the DB stores '{}'", async () => {
    // Bug repro: ScanRepository.create() inserts coverage_json='{}'. The
    // route must still return the canonical {fetched, failed, skipped}
    // shape so the client never sees `.fetched === undefined`.
    const db = new FakeD1Database();
    db.rows.push({
      sql: "SELECT * FROM scans WHERE id = ?",
      firstReturn: {
        id: "scan_queued",
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
    const response = await runWithDb(db, new Request("http://local/v1/scans/scan_queued"));
    expect(response.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await response.json()) as { coverage?: unknown };
    expect(body.coverage).toBeDefined();
    const coverage = body.coverage as { fetched?: unknown; failed?: unknown; skipped?: unknown };
    expect(coverage.fetched).toEqual([]);
    expect(coverage.failed).toEqual([]);
    expect(coverage.skipped).toEqual([]);
  });
});
