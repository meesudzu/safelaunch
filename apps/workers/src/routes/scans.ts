import { Hono } from "hono";
import { CreateScanInput, ScanState } from "@safelaunch/contracts";
import { ScanRepository, ReportRepository } from "@safelaunch/db";
import type { ScanResult, ScanTerminalState } from "../workflows/scan-workflow";

const SCAN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ANALYSIS_VERSION = "vn-mvp-v1";

export interface RoutesEnv {
  DB: D1Database;
  WEB_ORIGIN?: string;
  SCAN_WORKFLOW?: Workflow;
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
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return `scan_${out}`;
};

const TERMINAL_SCAN_STATES = new Set<string>(["completed", "partial", "failed"]);

const isTerminal = (state: string): state is ScanTerminalState =>
  TERMINAL_SCAN_STATES.has(state);

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

scansRouter.post("/v1/scans", async (context) => {
  let payload: unknown;
  try {
    payload = await context.req.json();
  } catch {
    return context.json({ code: "INVALID_JSON" }, 400);
  }
  const parsed = CreateScanInput.safeParse(payload);
  if (!parsed.success) {
    return context.json(
      { code: "INVALID_INPUT", issues: parsed.error.issues },
      400,
    );
  }
  const input = parsed.data;
  const repository = new ScanRepository(context.env.DB);
  const scanId = generateScanId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SCAN_TTL_SECONDS * 1000);
  await repository.create({
    id: scanId,
    url: input.url,
    jurisdiction: input.jurisdiction,
    category: input.category,
    analysisVersion: ANALYSIS_VERSION,
    now: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  // The actual scan execution is triggered by the Workflow binding at the
  // platform boundary; the API contract only persists the scan row. Logging
  // here intentionally avoids the reportUrl/token (none exists yet at create
  // time).
  console.log(
    JSON.stringify({
      level: "info",
      event: "scan.created",
      scanId,
      jurisdiction: input.jurisdiction,
      category: input.category,
    }),
  );
  // Trigger the scan workflow. The API contract only persists the scan row
  // here; the workflow performs fetching, evaluation, and report persistence
  // asynchronously. If the workflow binding is absent (local dev without
  // Workflows), the scan stays in `queued` until the cron sweep notices it.
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
  return context.json(response satisfies CreateScanResponse, 202);
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
    // Read the persisted report. token_hash === null means the token has
    // already been burned by a prior GET of /v1/reports/:scanId. We never
    // generate or rotate tokens here — the workflow issued exactly one at
    // persistReport time, and we surface that plaintext token (stored inside
    // payload_json) only while the hash is still valid.
    const reportRepo = new ReportRepository(context.env.DB);
    const storedReport = await reportRepo.get(scanId);
    if (storedReport && storedReport.tokenHash !== null) {
      try {
        const payload = JSON.parse(storedReport.payloadJson) as Record<string, unknown>;
        const token = typeof payload._reportToken === "string" ? payload._reportToken : null;
        if (token) {
          progress.reportUrl = buildReportUrl(origin, token);
        }
      } catch {
        // Malformed payload — treat as no report available.
      }
    }
  }
  return context.json(progress);
});

export type { ScanResult };
