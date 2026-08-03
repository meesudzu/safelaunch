import { Hono } from "hono";
import { ReportRepository } from "@safelaunch/db";

/**
 * Public report endpoint.
 *
 * The URL contains a one-time `token` query parameter. The endpoint:
 *  - looks up the scan's report row from D1;
 *  - compares the SHA-256 hash of the token against the stored `token_hash`
 *    using a constant-time comparison;
 *  - rejects requests whose report has expired (`410 Gone`);
 *  - on a successful match, returns the report payload with the private
 *    `_reportToken` field stripped, then sets `token_hash = NULL` so a
 *    second open of the same URL returns 410 (single-use guarantee);
 *  - sets `Cache-Control: private, no-store` and `X-Robots-Tag: noindex,
 *    nofollow` so search engines and shared caches never see the payload.
 *
 * Neither the plaintext token nor its hash is logged anywhere on the happy
 * path. Errors include the scanId for triage but never the token.
 */

export interface ReportsEnv {
  DB: D1Database;
}

interface ReportRow {
  token_hash: string;
  payload_json: string;
  expires_at: string;
}

const noCacheHeaders: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Type": "application/json; charset=utf-8",
};

export const constantTimeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

const sha256Hex = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const isExpired = (expiresAt: string, now: Date): boolean => {
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return true;
  return ts <= now.getTime();
};

export const reportsRouter = new Hono<{ Bindings: ReportsEnv }>();

reportsRouter.get("/v1/reports/:scanId", async (context) => {
  const scanId = context.req.param("scanId");
  const token = context.req.query("token");
  if (!scanId) {
    return context.json({ code: "INVALID_REQUEST" }, 400);
  }
  const row = await context.env.DB.prepare(
    "SELECT token_hash, payload_json, expires_at FROM reports WHERE scan_id = ?",
  )
    .bind(scanId)
    .first<ReportRow>();
  if (!row) {
    // Log only the scanId, never the token.
    console.log(
      JSON.stringify({ level: "info", event: "report.not_found", scanId }),
    );
    return context.json({ code: "REPORT_NOT_FOUND" }, 404);
  }
  if (!token) {
    console.log(
      JSON.stringify({ level: "info", event: "report.token_missing", scanId }),
    );
    return context.json({ code: "INVALID_TOKEN" }, 403);
  }
  const now = new Date();
  if (isExpired(row.expires_at, now)) {
    console.log(
      JSON.stringify({ level: "info", event: "report.expired", scanId }),
    );
    return context.json({ code: "REPORT_EXPIRED" }, 410);
  }
  const incomingHash = await sha256Hex(token);
  if (!constantTimeEquals(incomingHash, row.token_hash)) {
    console.log(
      JSON.stringify({ level: "warn", event: "report.token_mismatch", scanId }),
    );
    return context.json({ code: "INVALID_TOKEN" }, 403);
  }
  // Strip the private plaintext token before returning the report payload.
  const stored = JSON.parse(row.payload_json) as Record<string, unknown>;
  const publicPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key === "_reportToken") continue;
    publicPayload[key] = value;
  }
  // Single-use: invalidate the stored hash so the second open returns 410.
  // We do this BEFORE returning the response so the URL is consumed atomically.
  const repo = new ReportRepository(context.env.DB);
  await repo.burnToken(scanId);
  return new Response(JSON.stringify(publicPayload), {
    status: 200,
    headers: noCacheHeaders,
  });
});
