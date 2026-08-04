import { Hono } from "hono";
import { CreateScanInput, ScanState, ScanCachedResponse } from "@safelaunch/contracts";
import { ScanRepository, ReportRepository, RedeemRepository } from "@safelaunch/db";
import { domainKey } from "@safelaunch/compliance-core";
import { enforceAbuseControls, AbuseError, type AbuseControlsDeps } from "../middleware/abuse";
import {
  resolveScanRequest,
  toQuotaDay,
  type ScanLookup,
  type ReportGet,
} from "../services/quota-service";
import { hashRedeemCode } from "../services/redeem-codes";
import type { ScanResult, ScanTerminalState } from "../workflows/scan-workflow";

const SCAN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ANALYSIS_VERSION = "vn-mvp-v1";

export interface RoutesEnv {
  DB: D1Database;
  WEB_ORIGIN?: string;
  SCAN_WORKFLOW?: Workflow;
  ABUSE_RATE_LIMITER?: DurableObjectNamespace;
  ENABLE_DAILY_QUOTA?: string;
}

interface StoredScanRow {
  id: string;
  url: string;
  jurisdiction: string;
  category: string;
  state: string;
  coverage_json: string;
  analysis_version: string;
  created_at: string;
  expires_at: string;
}

export interface ScanRecord extends StoredScanRow {
  coverage: Record<string, unknown>;
}

const generateScanId = (): string => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return `scan_${out}`;
};

const extractTurnstileToken = (request: Request): string | null => {
  const form = request.headers.get("content-type") ?? "";
  if (!form.includes("application/json")) return null;
  return request.headers.get("cf-turnstile-response");
};

const TERMINAL_SCAN_STATES = new Set<string>(["completed", "partial", "failed"]);

const isTerminal = (state: string): state is ScanTerminalState => TERMINAL_SCAN_STATES.has(state);

const buildReportUrl = (origin: string, token: string, locale: string = "vi"): string =>
  `${origin.replace(/\/$/, "")}/${locale}/report/${token}`;

export interface CreateScanResponse {
  scanId: string;
  state: "queued";
}

export interface ScanProgressResponse {
  scanId: string;
  state: string;
  status?: string;
  coverage: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  reportUrl?: string;
}

export const scansRouter = new Hono<{ Bindings: RoutesEnv }>();

const isQuotaEnabled = (env: RoutesEnv): boolean => env.ENABLE_DAILY_QUOTA === "true";

/**
 * Build a ScanLookup bound to the given D1. The lookup uses the URL `host`
 * (via `LIKE`) so the quota check is per-host per day, without requiring
 * a new `domain_key` column on `scans`. The query is bounded by an inner
 * LIMIT so it cannot full-scan the table.
 */
const makeScanLookup =
  (db: D1Database): ScanLookup =>
  async (key, day, terminal) => {
    const placeholder = `https://%${key}/%`;
    const inner = await db
      .prepare(
        `SELECT id, state, created_at, expires_at FROM scans
         WHERE url LIKE ? AND substr(created_at, 1, 10) = ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(placeholder, day)
      .all<{ id: string; state: string; created_at: string; expires_at: string }>();
    const rows = (inner.results ?? []).filter((r) => terminal.includes(r.state));
    if (rows.length === 0) return null;
    const top = rows[0]!;
    // status is determined by the report row; the lookup returns null and
    // the route hydrates it from the report if needed.
    return {
      id: top.id,
      state: top.state,
      status: null,
      createdAt: top.created_at,
      expiresAt: top.expires_at,
    };
  };

const makeReportGet =
  (db: D1Database): ReportGet =>
  async (scanId) => {
    const row = await db
      .prepare("SELECT scan_id, payload_json FROM reports WHERE scan_id = ?")
      .bind(scanId)
      .first<{ scan_id: string; payload_json: string }>();
    if (!row) return null;
    return { payloadJson: row.payload_json };
  };

scansRouter.post("/v1/scans", async (context) => {
  let payload: unknown;
  try {
    payload = await context.req.json();
  } catch {
    return context.json({ code: "INVALID_JSON" }, 400);
  }
  const parsed = CreateScanInput.safeParse(payload);
  if (!parsed.success) {
    return context.json({ code: "INVALID_INPUT", issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  // Anonymous abuse controls: unchanged.
  if (context.env.ABUSE_RATE_LIMITER) {
    const clientIp = context.req.header("cf-connecting-ip") ?? "unknown";
    const submittedHost = context.req.header("origin") ?? new URL(input.url).host;
    const deps: AbuseControlsDeps = {
      rateLimiter: context.env.ABUSE_RATE_LIMITER.get(
        context.env.ABUSE_RATE_LIMITER.idFromName(`abuse::${clientIp}::${submittedHost}`),
      ),
    };
    try {
      await enforceAbuseControls(
        {
          ip: clientIp,
          hostname: submittedHost,
          turnstileToken: extractTurnstileToken(context.req.raw),
        },
        deps,
      );
    } catch (cause) {
      if (cause instanceof AbuseError) {
        const status = cause.status as 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500 | 502 | 503;
        return context.json({ code: cause.code }, status);
      }
      throw cause;
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const origin = context.env.WEB_ORIGIN ?? "http://localhost:3000";

  // New code path: only when the feature flag is on.
  if (isQuotaEnabled(context.env)) {
    const key = domainKey(input.url);
    const quotaDay = toQuotaDay(nowIso);
    const redeemRepo = new RedeemRepository(context.env.DB);
    const result = await resolveScanRequest({
      domainKey: key,
      quotaDay,
      now: nowIso,
      redeemCode: input.redeemCode ?? null,
      redeemRepo,
      scanLookup: makeScanLookup(context.env.DB),
      reportGet: makeReportGet(context.env.DB),
      hashCode: hashRedeemCode,
      buildReportUrl: (token) => buildReportUrl(origin, token),
    });

    if (result.kind === "rejected") {
      const status = result.reason === "INVALID_REDEEM_CODE" ? 400 : 401;
      return context.json({ code: result.reason }, status);
    }

    if (result.kind === "cached") {
      console.log(
        JSON.stringify({
          level: "info",
          event: "scan.cached_served",
          originalScanId: result.originalScanId,
          domainKey: key,
          quotaDay,
        }),
      );
      const cached: ScanCachedResponse = {
        scanId: result.originalScanId,
        state: result.state as ScanCachedResponse["state"],
        status: result.status as ScanCachedResponse["status"],
        coverage: { fetched: [], failed: [], skipped: [] },
        createdAt: result.createdAt,
        expiresAt: result.expiresAt,
        reportUrl: result.reportUrl,
        cached: true,
        quotaDay,
        domainKey: key,
        message: result.message,
      };
      return context.json(cached, 200);
    }

    // result.kind === "fresh" — log if a code unlocked it.
    if (result.codeId) {
      console.log(
        JSON.stringify({
          level: "info",
          event: "redeem.applied",
          codeId: result.codeId,
          domainKey: key,
          quotaDay,
          actor: "anonymous",
        }),
      );
    }
  }

  // Original fresh-scan path (unchanged when ENABLE_DAILY_QUOTA is off).
  const repository = new ScanRepository(context.env.DB);
  const scanId = generateScanId();
  const expiresAt = new Date(now.getTime() + SCAN_TTL_SECONDS * 1000);
  await repository.create({
    id: scanId,
    url: input.url,
    jurisdiction: input.jurisdiction,
    category: input.category,
    analysisVersion: ANALYSIS_VERSION,
    now: nowIso,
    expiresAt: expiresAt.toISOString(),
  });

  console.log(
    JSON.stringify({
      level: "info",
      event: "scan.created",
      scanId,
      jurisdiction: input.jurisdiction,
      category: input.category,
    }),
  );

  const workflow = context.env.SCAN_WORKFLOW;
  if (workflow) {
    try {
      await workflow.create({
        params: {
          scanId,
          url: input.url,
          jurisdiction: input.jurisdiction,
          category: input.category,
          analysisVersion: ANALYSIS_VERSION,
        },
      });
    } catch (cause) {
      console.log(
        JSON.stringify({
          level: "warn",
          event: "scan.workflow_create_failed",
          scanId,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  }

  const response: CreateScanResponse = { scanId, state: "queued" };
  return context.json(response, 202);
});

scansRouter.get("/v1/scans/:id", async (context) => {
  const scanId = context.req.param("id");
  if (!scanId || scanId.length > 256) {
    return context.json({ code: "INVALID_SCAN_ID" }, 400);
  }
  const repository = new ScanRepository(context.env.DB);
  const stored = await repository.get(scanId);
  if (!stored) {
    return context.json({ code: "SCAN_NOT_FOUND" }, 404);
  }
  const origin = context.env.WEB_ORIGIN ?? "http://localhost:3000";
  const progress: ScanProgressResponse = {
    scanId: stored.id,
    state: stored.state,
    coverage: stored.coverage,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
  };
  if (isTerminal(stored.state)) {
    const status = ScanState.parse(stored.state);
    progress.status = status;
    const reportRepo = new ReportRepository(context.env.DB);
    const storedReport = await reportRepo.get(scanId);
    if (storedReport && storedReport.tokenHash !== null) {
      try {
        const payload = JSON.parse(storedReport.payloadJson) as Record<string, unknown>;
        const token = typeof payload._reportToken === "string" ? payload._reportToken : null;
        if (token) progress.reportUrl = buildReportUrl(origin, token);
      } catch {
        // ignore
      }
    }
  }
  return context.json(progress);
});

export type { ScanResult };
