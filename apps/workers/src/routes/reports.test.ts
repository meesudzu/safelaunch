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
      {
        tokenHash: stored,
        payloadJson: payload,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({
      scanId: "scan-1",
      status: "high_risk",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
  });
  it("includes the row's expiresAt on the public payload so the legacy scanId-keyed route matches", async () => {
    // Same regression as the by-token route: the public payload must
    // include the row's `expires_at` so the report page can render
    // the expiry date. Both routes share the same payload shape.
    const stored = await sha256("correct-token");
    const payload = JSON.stringify({ scanId: "scan-1", status: "high_risk" });
    const db = new FakeD1Database();
    const response = await runWithDb(
      db,
      new Request("http://local/v1/reports/rpt_abc?token=correct-token"),
      {
        tokenHash: stored,
        payloadJson: payload,
        expiresAt: "2026-08-13T10:00:00.000Z",
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expiresAt).toBe("2026-08-13T10:00:00.000Z");
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
      await runWithDb(db, new Request("http://local/v1/reports/rpt_abc?token=secret-token"), {
        tokenHash: stored,
      });
    } finally {
      console.error = origError;
    }
    const blob = errSpy.join("\n");
    expect(blob).not.toContain("secret-token");
    expect(blob).not.toContain(stored);
  });
});

const runWithDbByToken = async (
  db: FakeD1Database,
  request: Request,
  body?: { tokenHash?: string; payloadJson?: string; expiresAt?: string },
  options?: { repeat?: number },
) => {
  // Repeat the SELECT setup `repeat` times so we can verify that the
  // route does NOT burn the token between calls. Each repetition gets
  // its own row entry on the FakeD1Database in case the test wants to
  // observe the DML after the first response.
  const repeats = Math.max(1, options?.repeat ?? 1);
  const app = buildApp();
  for (let i = 0; i < repeats; i += 1) {
    if (body?.tokenHash) {
      db.rows.push({
        sql: "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE token_hash = ?",
        firstReturn: {
          scan_id: "scan_f46f0cfd3c85cc9c5951a22b9b804840d3e8",
          token_hash: body.tokenHash,
          payload_json: body.payloadJson ?? "{}",
          expires_at: body.expiresAt ?? "2099-01-01T00:00:00.000Z",
        },
        runReturn: null,
      });
    } else {
      db.rows.push({
        sql: "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE token_hash = ?",
        firstReturn: null,
        runReturn: null,
      });
    }
  }
  return app.fetch(request, { DB: db });
};

describe("reports router — by-token lookup", () => {
  it("returns 404 when no row matches the token hash", async () => {
    const db = new FakeD1Database();
    const response = await runWithDbByToken(
      db,
      new Request("http://local/v1/reports/by-token/some-token"),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ code: "REPORT_NOT_FOUND" });
  });

  it("returns the payload with no-cache headers when the token hash matches", async () => {
    const token = "rpt_dd5196a8aec1ead9d9ccd39d0d7b2109a557f1a333001bdc";
    const stored = await sha256(token);
    const payload = JSON.stringify({
      scanId: "scan_f46f0cfd3c85cc9c5951a22b9b804840d3e8",
      status: "high_risk",
    });
    const db = new FakeD1Database();
    const response = await runWithDbByToken(
      db,
      new Request(`http://local/v1/reports/by-token/${encodeURIComponent(token)}`),
      {
        tokenHash: stored,
        payloadJson: payload,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({
      scanId: "scan_f46f0cfd3c85cc9c5951a22b9b804840d3e8",
      status: "high_risk",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(body).not.toHaveProperty("_reportToken");
  });
  it("includes the row's expiresAt on the public payload so the report page can show the expiry date", async () => {
    // Regression: the /vi/report/<token> page reads `payload.expiresAt`
    // to render "Báo cáo hết hạn vào <date>". Earlier versions only
    // returned the stored `payload_json` (which never contained an
    // `expiresAt` field) and never copied the row's `expires_at`
    // column into the response, so the footer rendered just the label
    // with no date. The route must surface the row's `expires_at` to
    // every successful response.
    const token = "rpt_expiry_abc";
    const stored = await sha256(token);
    const payload = JSON.stringify({
      scanId: "scan_f46f0cfd3c85cc9c5951a22b9b804840d3e8",
      status: "needs_review",
    });
    const db = new FakeD1Database();
    const response = await runWithDbByToken(
      db,
      new Request(`http://local/v1/reports/by-token/${encodeURIComponent(token)}`),
      {
        tokenHash: stored,
        payloadJson: payload,
        expiresAt: "2026-08-13T10:00:00.000Z",
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expiresAt).toBe("2026-08-13T10:00:00.000Z");
  });

  it("returns 410 Gone when the matched report has expired", async () => {
    const token = "rpt_expired";
    const stored = await sha256(token);
    const db = new FakeD1Database();
    const response = await runWithDbByToken(
      db,
      new Request(`http://local/v1/reports/by-token/${token}`),
      { tokenHash: stored, expiresAt: "2020-01-01T00:00:00.000Z" },
    );
    expect(response.status).toBe(410);
  });

  it("allows the same URL to be read repeatedly until the report expires", async () => {
    // Regression: the report page is server-rendered (Next.js page
    // component), so a hard reload of `/vi/report/<token>` re-runs the
    // GET against this endpoint. Earlier versions invalidated the
    // stored token_hash on the first successful read (single-use
    // guarantee), which made every reload after the first open return
    // 404 REPORT_NOT_FOUND. We now keep token_hash across reads so the
    // owner can refresh, copy the URL, etc., until `expires_at`.
    const token = "rpt_reusable_abc";
    const stored = await sha256(token);
    const payload = JSON.stringify({
      scanId: "scan_f46f0cfd3c85cc9c5951a22b9b804840d3e8",
      status: "no_significant_risk",
    });
    const db = new FakeD1Database();

    // First read.
    const first = await runWithDbByToken(
      db,
      new Request(`http://local/v1/reports/by-token/${token}`),
      {
        tokenHash: stored,
        payloadJson: payload,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      { repeat: 2 },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      scanId: "scan_f46f0cfd3c85cc9c5951a22b9b804840d3e8",
      status: "no_significant_risk",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    // Body must NOT contain the private _reportToken field.
    expect(firstBody).not.toHaveProperty("_reportToken");

    // Second read of the SAME URL with the SAME token — must succeed
    // and return the same payload. (With single-use, this would have
    // been 404.)
    const second = await runWithDbByToken(
      db,
      new Request(`http://local/v1/reports/by-token/${token}`),
      { tokenHash: stored, payloadJson: payload },
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
  });

  it("still returns 404 when no row matches the supplied token hash", async () => {
    // Distinct from the now-removed "burned" test: 404 here means the
    // URL points at no report we ever generated. With token burning
    // disabled, this is the only way to get 404 from this route.
    const db = new FakeD1Database();
    const response = await runWithDbByToken(
      db,
      new Request("http://local/v1/reports/by-token/rpt_never_existed"),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ code: "REPORT_NOT_FOUND" });
  });

  it("never logs the plaintext token or its hash via the by-token path", async () => {
    const token = "rpt_secret_token";
    const stored = await sha256(token);
    const db = new FakeD1Database();
    const errSpy: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errSpy.push(args.map(String).join(" "));
      origError(...args);
    };
    try {
      await runWithDbByToken(db, new Request(`http://local/v1/reports/by-token/${token}`), {
        tokenHash: stored,
      });
    } finally {
      console.error = origError;
    }
    const blob = errSpy.join("\n");
    expect(blob).not.toContain(token);
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
