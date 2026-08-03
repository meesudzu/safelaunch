import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { reportsRouter, constantTimeEquals } from "./reports";

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
        this.preparedCalls.push({ sql, bindings });
        const row = this.rows.find((entry) => entry.sql === sql);
        const firstReturn = row?.firstReturn;
        const runReturn = row?.runReturn ?? { success: true, meta: { duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false } };
        return {
          first: async <T>(): Promise<T | null> => {
            await Promise.resolve();
            return firstReturn as T | null;
          },
          run: async <T>(): Promise<D1Result<T>> => {
            await Promise.resolve();
            if (runReturn !== undefined && runReturn !== null) {
              return runReturn as D1Result<T>;
            }
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
          all: async <T>(): Promise<D1Result<T>> => {
            await Promise.resolve();
            return {
              results: [] as never,
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

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
  batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    void statements;
    return Promise.resolve([]);
  }
  exec(): Promise<D1ExecResult> {
    return Promise.resolve({ count: 0, duration: 0 });
  }
  withSession(): D1DatabaseSession {
    return {} as D1DatabaseSession;
  }
}

const buildApp = () => {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.route("/", reportsRouter);
  return app;
};

const runWithDb = async (
  db: FakeD1Database,
  request: Request,
  body?: { tokenHash?: string; payloadJson?: string; expiresAt?: string },
) => {
  const app = buildApp();
  if (body?.tokenHash) {
    db.rows.push({
      sql: "SELECT token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
      firstReturn: {
        token_hash: body.tokenHash,
        payload_json: body.payloadJson ?? "{}",
        expires_at: body.expiresAt ?? "2099-01-01T00:00:00.000Z",
      },
      runReturn: null,
    });
  } else {
    db.rows.push({
      sql: "SELECT token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
      firstReturn: null,
      runReturn: null,
    });
  }
  return app.fetch(request, { DB: db });
};

const sha256 = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

describe("reports router", () => {
  it("returns 404 when the scan is not in D1", async () => {
    const db = new FakeD1Database();
    const response = await runWithDb(db, new Request("http://local/v1/reports/rpt_abc"));
    expect(response.status).toBe(404);
  });

  it("returns 403 when the token hash does not match the stored hash", async () => {
    const stored = await sha256("correct-token");
    const db = new FakeD1Database();
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=wrong-token"),
      { tokenHash: stored },
    );
    expect(response.status).toBe(403);
  });

  it("returns the payload with no-cache headers when the token is correct", async () => {
    const stored = await sha256("correct-token");
    const payload = JSON.stringify({ scanId: "scan-1", status: "high_risk" });
    const db = new FakeD1Database();
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=correct-token"),
      { tokenHash: stored, payloadJson: payload },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({ scanId: "scan-1", status: "high_risk" });
  });

  it("returns 410 Gone when the report has expired", async () => {
    const stored = await sha256("correct-token");
    const db = new FakeD1Database();
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=correct-token"),
      {
        tokenHash: stored,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    );
    expect(response.status).toBe(410);
  });

  it("never logs the plaintext token or its hash", async () => {
    const stored = await sha256("secret-token");
    const db = new FakeD1Database();
    const errSpy: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errSpy.push(args.map(String).join(" "));
      origError(...args);
    };
    try {
      await runWithDb(
        db,
        new Request("http://local/v1/reports/rpt_abc?token=secret-token"),
        { tokenHash: stored },
      );
    } finally {
      console.error = origError;
    }
    const blob = errSpy.join("\n");
    expect(blob).not.toContain("secret-token");
    expect(blob).not.toContain(stored);
  });
});

describe("constantTimeEquals", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEquals("abcdef", "abcdef")).toBe(true);
  });
  it("returns false for unequal strings of the same length", () => {
    expect(constantTimeEquals("abcdef", "abcdeg")).toBe(false);
  });
  it("returns false for strings of different length", () => {
    expect(constantTimeEquals("abc", "abcdef")).toBe(false);
  });
});
