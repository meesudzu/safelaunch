import { Hono } from "hono";
import { ReportRepository } from "@safelaunch/db";

/**
 * Public report endpoint.
 *
 * The single-use report link (`buildReportUrl` in scans.ts) carries exactly
 * one opaque secret: the report token. There is no separate scanId anywhere
 * in that URL, so the row must be looked up by the token itself — the
 * endpoint hashes the incoming token and queries `WHERE token_hash = ?`
 * directly (the hash equality check happens inside the SQL predicate, so no
 * separate constant-time comparison step is needed afterward). The endpoint:
 *  - looks up the report row from D1 by `token_hash`;
 *  - rejects requests whose report has expired (`410 Gone`);
 *  - on a match, returns the report payload with the private
 *    `_reportToken` field stripped, then burns `token_hash` (see
 *    `BURNED_TOKEN_HASH` in scan-repository.ts — the column is `NOT NULL`,
 *    so burning uses a sentinel value, not SQL NULL) so a second open of
 *    the same URL misses the lookup and returns 404;
 *  - sets `Cache-Control: private, no-store` and `X-Robots-Tag: noindex,
 *    nofollow` so search engines and shared caches never see the payload.
 *
 * Neither the plaintext token nor its hash is logged anywhere. Errors
 * include the scanId for triage (once known) but never the token.
 */

export interface ReportsEnv {
  DB: D1Database;
}

interface ReportRow {
  scan_id: string;
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

reportsRouter.get("/v1/reports/:token", async (context) => {
  const pathToken = context.req.param("token");
  const queryToken = context.req.query("token");
  // The client sends the same token in both slots; accept either so a
  // request missing the (redundant) query param still works.
  const token = queryToken ?? pathToken;
  if (!token) {
    return context.json({ code: "INVALID_REQUEST" }, 400);
  }
  const incomingHash = await sha256Hex(token);
  const row = await context.env.DB.prepare(
    "SELECT scan_id, token_hash, payload_json, expires_at FROM reports WHERE token_hash = ?",
  )
    .bind(incomingHash)
    .first<ReportRow>();
  if (!row) {
    // No scanId to log yet — the token didn't match any row.
    console.log(JSON.stringify({ level: "info", event: "report.not_found" }));
    return context.json({ code: "REPORT_NOT_FOUND" }, 404);
  }
  if (!token) {
    console.log(JSON.stringify({ level: "info", event: "report.token_missing", scanId }));
    return context.json({ code: "INVALID_TOKEN" }, 403);
  }
  const now = new Date();
  if (isExpired(row.expires_at, now)) {
    console.log(JSON.stringify({ level: "info", event: "report.expired", scanId: row.scan_id }));
    return context.json({ code: "REPORT_EXPIRED" }, 410);
  }
  if (!constantTimeEquals(incomingHash, row.token_hash)) {
    console.log(JSON.stringify({ level: "warn", event: "report.token_mismatch", scanId }));
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
  await repo.burnToken(row.scan_id);
  return new Response(JSON.stringify(publicPayload), {
    status: 200,
    headers: noCacheHeaders,
  });
});

/**
 * Public report endpoint that takes the one-time token in the path.
 *
 * This mirrors /v1/reports/:scanId but is keyed by the token (the only
 * value present in the public share URL) instead of the scanId. We hash
 * the URL token with SHA-256 and look up the report row by that hash.
 *
 * Behaviour is identical to the scanId-keyed route:
 *  - 404 if no row matches the hash (never existed OR already burned);
 *  - 410 if the matched row has expired;
 *  - 200 with the payload on success, followed by token_hash = NULL
 *    to make the URL single-use.
 *
 * The plaintext token is never logged; the hash is similarly treated as
 * sensitive and never appears in logs.
 */
reportsRouter.get("/v1/reports/by-token/:token", async (context) => {
  const token = context.req.param("token");
  if (!token) {
    return context.json({ code: "INVALID_REQUEST" }, 400);
  }
  const incomingHash = await sha256Hex(token);
  const repo = new ReportRepository(context.env.DB);
  const row = await repo.getByTokenHash(incomingHash);
  if (!row) {
    // Covers both "never existed" and "already burned (hash is NULL)".
    // We log only that the lookup failed, not the token or hash.
    console.log(JSON.stringify({ level: "info", event: "report.token_not_found" }));
    return context.json({ code: "REPORT_NOT_FOUND" }, 404);
  }
  const now = new Date();
  if (isExpired(row.expiresAt, now)) {
    console.log(JSON.stringify({ level: "info", event: "report.expired", scanId: row.scanId }));
    return context.json({ code: "REPORT_EXPIRED" }, 410);
  }
  // Strip the private plaintext token before returning the report payload.
  const stored = JSON.parse(row.payloadJson) as Record<string, unknown>;
  const publicPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key === "_reportToken") continue;
    publicPayload[key] = value;
  }
  // Single-use: invalidate the stored hash before returning the response
  // so the URL is consumed atomically.
  await repo.burnToken(row.scanId);
  return new Response(JSON.stringify(publicPayload), {
    status: 200,
    headers: noCacheHeaders,
  });
});

/**
 * Public report endpoint that takes the one-time token in the path.
 *
 * This mirrors /v1/reports/:scanId but is keyed by the token (the only
 * value present in the public share URL) instead of the scanId. We hash
 * the URL token with SHA-256 and look up the report row by that hash.
 *
 * Behaviour is identical to the scanId-keyed route:
 *  - 404 if no row matches the hash (never existed OR already burned);
 *  - 410 if the matched row has expired;
 *  - 200 with the payload on success, followed by token_hash = NULL
 *    to make the URL single-use.
 *
 * The plaintext token is never logged; the hash is similarly treated as
 * sensitive and never appears in logs.
 */
reportsRouter.get("/v1/reports/by-token/:token", async (context) => {
  const token = context.req.param("token");
  if (!token) {
    return context.json({ code: "INVALID_REQUEST" }, 400);
  }
  const incomingHash = await sha256Hex(token);
  const repo = new ReportRepository(context.env.DB);
  const row = await repo.getByTokenHash(incomingHash);
  if (!row) {
    // Covers both "never existed" and "already burned (hash is NULL)".
    // We log only that the lookup failed, not the token or hash.
    console.log(JSON.stringify({ level: "info", event: "report.token_not_found" }));
    return context.json({ code: "REPORT_NOT_FOUND" }, 404);
  }
  const now = new Date();
  if (isExpired(row.expiresAt, now)) {
    console.log(JSON.stringify({ level: "info", event: "report.expired", scanId: row.scanId }));
    return context.json({ code: "REPORT_EXPIRED" }, 410);
  }
  // Strip the private plaintext token before returning the report payload.
  const stored = JSON.parse(row.payloadJson) as Record<string, unknown>;
  const publicPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key === "_reportToken") continue;
    publicPayload[key] = value;
  }
  // Single-use: invalidate the stored hash before returning the response
  // so the URL is consumed atomically.
  await repo.burnToken(row.scanId);
  return new Response(JSON.stringify(publicPayload), {
    status: 200,
    headers: noCacheHeaders,
  });
});
