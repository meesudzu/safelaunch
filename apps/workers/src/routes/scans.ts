import { Hono } from "hono";
import { CreateScanInput, ScanState } from "@safelaunch/contracts";
import { ScanRepository } from "@safelaunch/db";
import type { ScanResult, ScanTerminalState } from "../workflows/scan-workflow";

const SCAN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ANALYSIS_VERSION = "vn-mvp-v1";

export interface RoutesEnv {
  DB: D1Database;
  WEB_ORIGIN?: string;
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

const generateReportToken = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return `rpt_${out}`;
};

const hashToken = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const TERMINAL_SCAN_STATES = new Set<string>(["completed", "partial", "failed"]);

const isTerminal = (state: string): state is ScanTerminalState =>
  TERMINAL_SCAN_STATES.has(state);

const buildReportUrl = (origin: string, token: string): string =>
  `${origin.replace(/\/$/, "")}/reports/${token}`;

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
    const reportRow = await context.env.DB
      .prepare("SELECT token_hash FROM reports WHERE scan_id = ?")
      .bind(scanId)
      .first<{ token_hash: string }>();
    if (reportRow && reportRow.token_hash) {
      const token = generateReportToken();
      const tokenHash = await hashToken(token);
      // One-time: invalidate the stored hash so subsequent GETs cannot get a URL.
      await context.env.DB
        .prepare("UPDATE reports SET token_hash = ? WHERE scan_id = ?")
        .bind(tokenHash, scanId)
        .run();
      progress.reportUrl = buildReportUrl(origin, token);
    }
  }
  return context.json(progress);
});

export type { ScanResult };
