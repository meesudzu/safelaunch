import { Hono } from "hono";
import { ReportRepository } from "@safelaunch/db";

/**
 * Public report endpoint.
 *
 * The URL contains a one-time-shaped `token` query parameter. The endpoint:
 *  - looks up the scan's report row from D1;
 *  - compares the SHA-256 hash of the token against the stored `token_hash`
 *    using a constant-time comparison;
 *  - rejects requests whose report has expired (`410 Gone`);
 *  - on a successful match, returns the report payload with the private
 *    `_reportToken` field stripped.
 *
 * The URL is intentionally NOT single-use: the owner (and anyone they
 * share the link with) can open the report repeatedly until `expires_at`.
 * Earlier versions burned the token after the first successful read, which
 * broke hard-reloads on the report page. We keep `Cache-Control: private,
 * no-store` and `X-Robots-Tag: noindex, nofollow` so public caches and
 * search engines never see the payload, but the server itself is happy
 * to re-serve the same report to the same URL.
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
    console.log(JSON.stringify({ level: "info", event: "report.not_found", scanId }));
    return context.json({ code: "REPORT_NOT_FOUND" }, 404);
  }
  if (!token) {
    console.log(JSON.stringify({ level: "info", event: "report.token_missing", scanId }));
    return context.json({ code: "INVALID_TOKEN" }, 403);
  }
  const now = new Date();
  if (isExpired(row.expires_at, now)) {
    console.log(JSON.stringify({ level: "info", event: "report.expired", scanId }));
    return context.json({ code: "REPORT_EXPIRED" }, 410);
  }
  const incomingHash = await sha256Hex(token);
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
  // The token is reusable until the report's `expires_at`; we do NOT burn
  // `token_hash` on success. Earlier versions invalidated the row here for
  // single-use privacy, but that broke reloads on the owner-facing report
  // page. See routes/reports.test.ts for the regression coverage.
  return new Response(JSON.stringify(publicPayload), {
    status: 200,
    headers: noCacheHeaders,
  });
});

/**
 * Public report endpoint keyed by the URL token (instead of scanId).
 *
 * The URL looks like `/vi/report/<token>`; only the token reaches the
 * server. We hash the URL token with SHA-256 and look up the report row
 * by that hash — never by scanId, which stays internal.
 *
 * Behaviour:
 *  - 404 if no row matches the hash (report never existed for this URL);
 *  - 410 if the matched row has expired (`expires_at` <= now);
 *  - 403 if the hash mismatches the stored hash (constant-time comparison);
 *  - 200 with the payload on success. The URL can be opened repeatedly
 *    until the report expires — see the file-level note for why we no
 *    longer burn the token.
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
    // No report row matches the supplied token hash. Earlier versions
    // also returned 404 here when the row had been burned, but token
    // burning was removed so this branch now strictly means "this URL
    // does not correspond to any report we generated".
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
  // Reusable-until-expiry: do NOT burn `token_hash`. Owner-side reloads
  // must work; see file-level note.
  return new Response(JSON.stringify(publicPayload), {
    status: 200,
    headers: noCacheHeaders,
  });
});
