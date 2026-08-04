import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { reportsRouter, constantTimeEquals } from "./reports";

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

class FakeD1Database implements D1Database {
  preparedCalls: QueryCall[] = [];
  rows: { sql: string; bindings?: unknown[]; firstReturn: unknown; runReturn: unknown }[] = [];

  prepare(sql: string) {
    const stmt = {
      bind: (...bindings: unknown[]) => {
        this.preparedCalls.push({ sql, bindings });
        const row = this.rows.find(
          (entry) =>
            entry.sql === sql &&
            (entry.bindings === undefined ||
              JSON.stringify(entry.bindings) === JSON.stringify(bindings)),
        );
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
          },
        };
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

const REPORT_LOOKUP_SQL =
  "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE token_hash = ?";

const sha256 = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Seeds a report row that the fake DB will only return when queried with the
 * hash of `validToken` — a wrong token therefore genuinely misses (matching
 * real D1 behavior), rather than matching on SQL text alone regardless of
 * the bound value (the gap that let the old scan_id/token_hash mismatch
 * bug pass its tests undetected).
 */
const seedReport = async (
  db: FakeD1Database,
  input: { validToken: string; scanId?: string; payloadJson?: string; expiresAt?: string },
) => {
  const hash = await sha256(input.validToken);
  db.rows.push({
    sql: REPORT_LOOKUP_SQL,
    bindings: [hash],
    firstReturn: {
      scan_id: input.scanId ?? "scan-1",
      token_hash: hash,
      payload_json: input.payloadJson ?? "{}",
      expires_at: input.expiresAt ?? "2099-01-01T00:00:00.000Z",
    },
    runReturn: null,
  });
};

const runWithDb = (db: FakeD1Database, request: Request) => buildApp().fetch(request, { DB: db });

describe("reports router", () => {
  it("returns 404 when no report matches the token", async () => {
    const db = new FakeD1Database();
    const response = await runWithDb(db, new Request("http://local/v1/reports/rpt_abc"));
    expect(response.status).toBe(404);
  });

  it("returns 404 (not 403) when the token doesn't match any stored hash", async () => {
    // Deliberately not distinguishing "wrong token" from "no such report" —
    // that distinction would leak whether a report exists at all.
    const db = new FakeD1Database();
    await seedReport(db, { validToken: "correct-token" });
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=wrong-token"),
    );
    expect(response.status).toBe(404);
  });

  it("looks up by the token itself, not a separate scanId path param", async () => {
    // Regression test: buildReportUrl (scans.ts) and api-client.ts only ever
    // put the token in the URL — there is no separate scanId anywhere in a
    // real report link, so the path segment must resolve via the token hash.
    const db = new FakeD1Database();
    await seedReport(db, { validToken: "correct-token", scanId: "scan-42" });
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/correct-token?token=correct-token"),
    );
    expect(response.status).toBe(200);
  });

  it("returns the payload with no-cache headers when the token is correct", async () => {
    const db = new FakeD1Database();
    const payload = JSON.stringify({ scanId: "scan-1", status: "high_risk" });
    await seedReport(db, { validToken: "correct-token", payloadJson: payload });
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=correct-token"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({ scanId: "scan-1", status: "high_risk" });
  });

  it("returns 410 Gone when the report has expired", async () => {
    const db = new FakeD1Database();
    await seedReport(db, {
      validToken: "correct-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=correct-token"),
    );
    expect(response.status).toBe(410);
  });

  it("never logs the plaintext token or its hash", async () => {
    const db = new FakeD1Database();
    await seedReport(db, { validToken: "secret-token" });
    const errSpy: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errSpy.push(args.map(String).join(" "));
      origError(...args);
    };
    try {
      await runWithDb(db, new Request("http://local/v1/reports/rpt_abc?token=secret-token"));
    } finally {
      console.error = origError;
    }
    const blob = errSpy.join("\n");
    expect(blob).not.toContain("secret-token");
    expect(blob).not.toContain(await sha256("secret-token"));
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
