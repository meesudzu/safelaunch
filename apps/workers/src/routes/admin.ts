import { Hono } from "hono";

/**
 * Admin legal-review endpoints. Access control lives at the Cloudflare
 * Access layer (the `/admin/*` paths are gated by an Access application
 * that issues a JWT to the browser). The Worker trusts the validated
 * JWT claims forwarded by Cloudflare:
 *
 *   - `cf-access-authenticated-user-email`  → used as the audit `actor`
 *
 * For the MVP we accept any request that reaches this router — the
 * upstream Cloudflare Access policy is the source of truth. When the
 * Access app is misconfigured the endpoint will simply be unreachable
 * from the public internet, not silently authorized.
 */

export interface AdminEnv {
  DB: D1Database;
}

interface PendingDocumentRow {
  id: string;
  jurisdiction: string;
  source_url: string;
  title: string;
  retrieved_at: string;
  source_hash: string;
  effective_from: string | null;
  effective_to: string | null;
}

interface ProvisionRow {
  id: string;
  document_id: string;
  article: string;
  clause: string | null;
  text: string;
  categories_json: string;
}

interface RelationRow {
  id: string;
  from_document_id: string;
  to_document_id: string;
  relation_type: string;
}

interface AuditRow {
  actor: string;
  decision: string;
  reason: string;
  created_at: string;
}

interface AuditListRow extends AuditRow {
  id: string;
  document_title: string | null;
  jurisdiction: string | null;
}

interface AuditCursor {
  createdAt: string;
  id: string;
}

type UsageMetricKey = "scans24h" | "uniqueSites24h" | "reportsOpened24h" | "activeReviewers24h";

interface CountRow {
  scans?: number;
  sites?: number;
  reports?: number;
  reviewers?: number;
}

interface AdminScanListRow {
  id: string;
  created_at: string;
  jurisdiction: string;
  category: string;
  state: string;
  expires_at: string;
  url_hash: string | null;
  total_pages: number | null;
  pages_done: number | null;
}

interface AdminScanDetailRow {
  id: string;
  created_at: string;
  jurisdiction: string;
  category: string;
  state: string;
  expires_at: string;
  url_hash: string | null;
  coverage_json: string;
}

interface FindingSeverityRow {
  severity: string;
  n: number;
}

interface AnalysisRunRow {
  model_id: string;
  prompt_version: string;
  retrieval_version: string;
  created_at: string;
}

interface ReportLinkRow {
  payload_json: string;
  expires_at: string;
}

const RESOLVED_ACTOR = (request: Request): string => {
  // Cloudflare Access forwards the authenticated user's email as a header.
  // In local dev (no Access app), fall back to a stable placeholder so
  // audit rows still record *some* actor.
  return request.headers.get("cf-access-authenticated-user-email") ?? "local-dev-reviewer";
};

export const adminRouter = new Hono<{ Bindings: AdminEnv }>();

adminRouter.get("/metrics/usage", async (context) => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const previousStart = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const [scansCurrent, scansPrevious, uniqueSites, reportsOpened, activeReviewers] =
    await Promise.all([
      countValue(
        context.env.DB.prepare("SELECT COUNT(*) AS scans FROM scans WHERE created_at >= ?")
          .bind(windowStart)
          .first<CountRow>(),
        "scans",
      ),
      countValue(
        context.env.DB.prepare(
          "SELECT COUNT(*) AS scans FROM scans WHERE created_at >= ? AND created_at < ?",
        )
          .bind(previousStart, windowStart)
          .first<CountRow>(),
        "scans",
      ),
      countValue(
        context.env.DB.prepare(
          "SELECT COUNT(DISTINCT url_hash) AS sites FROM scans WHERE created_at >= ? AND url_hash IS NOT NULL",
        )
          .bind(windowStart)
          .first<CountRow>(),
        "sites",
      ),
      countValue(
        context.env.DB.prepare(
          "SELECT COUNT(*) AS reports FROM reports r JOIN scans s ON s.id = r.scan_id WHERE r.expires_at > ? AND s.created_at >= ?",
        )
          .bind(nowIso, windowStart)
          .first<CountRow>(),
        "reports",
      ),
      countValue(
        context.env.DB.prepare(
          "SELECT COUNT(DISTINCT actor) AS reviewers FROM legal_review_events WHERE created_at >= ?",
        )
          .bind(windowStart)
          .first<CountRow>(),
        "reviewers",
      ),
    ]);

  return context.json({
    windowHours: 24,
    generatedAt: nowIso,
    tiles: [
      metricTile("scans24h", "Scans in last 24h", scansCurrent, scansCurrent - scansPrevious),
      metricTile("uniqueSites24h", "Unique sites scanned", uniqueSites),
      metricTile("reportsOpened24h", "Reports opened", reportsOpened),
      metricTile("activeReviewers24h", "Active reviewers", activeReviewers),
    ],
  });
});

adminRouter.get("/scans", async (context) => {
  const query = context.req.query();
  const limit = clampLimit(query.limit ?? "100");
  const live = pickString(query.live) !== "false";
  const rawFrom = pickString(query.from);
  const rawTo = pickString(query.to);
  if ((rawFrom && !isIsoDate(rawFrom)) || (rawTo && !isIsoDate(rawTo))) {
    return context.json({ code: "INVALID_DATE" }, 400);
  }

  const filters: string[] = [];
  const bindings: unknown[] = [];
  if (live) {
    filters.push("s.state NOT IN ('completed','failed','partial')");
    filters.push("s.created_at >= ?");
    bindings.push(daysAgoIso(1));
  } else {
    const state = pickString(query.state);
    const jurisdiction = pickString(query.jurisdiction);
    const category = pickString(query.category);
    if (state) {
      filters.push("s.state = ?");
      bindings.push(state);
    }
    if (jurisdiction) {
      filters.push("s.jurisdiction = ?");
      bindings.push(jurisdiction);
    }
    if (category) {
      filters.push("s.category = ?");
      bindings.push(category);
    }
    if (rawFrom) {
      filters.push("s.created_at >= ?");
      bindings.push(rawFrom);
    }
    if (rawTo) {
      filters.push("s.created_at <= ?");
      bindings.push(rawTo);
    }
  }
  bindings.push(limit);

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await context.env.DB.prepare(
    "SELECT s.id, s.created_at, s.jurisdiction, s.category, s.state, s.expires_at, s.url_hash, " +
      "COUNT(p.id) AS total_pages, SUM(CASE WHEN p.state = 'completed' THEN 1 ELSE 0 END) AS pages_done " +
      "FROM scans s LEFT JOIN scan_pages p ON p.scan_id = s.id " +
      `${where} ` +
      "GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
  )
    .bind(...bindings)
    .all<AdminScanListRow>();

  return context.json({
    scans: (result.results ?? []).map(toAdminScanSummary),
    nextCursor: null,
    live,
  });
});

adminRouter.get("/scans/:scanId", async (context) => {
  const scanId = context.req.param("scanId");
  if (!scanId || scanId.length > 256) {
    return context.json({ code: "INVALID_SCAN_ID" }, 400);
  }

  const scan = await context.env.DB.prepare(
    "SELECT id, created_at, jurisdiction, category, state, expires_at, url_hash, coverage_json FROM scans WHERE id = ?",
  )
    .bind(scanId)
    .first<AdminScanDetailRow>();
  if (!scan) {
    return context.json({ code: "NOT_FOUND" }, 404);
  }

  const nowIso = new Date().toISOString();
  const [severityResult, analysisResult, report] = await Promise.all([
    context.env.DB.prepare(
      "SELECT severity, COUNT(*) AS n FROM findings WHERE scan_id = ? GROUP BY severity",
    )
      .bind(scanId)
      .all<FindingSeverityRow>(),
    context.env.DB.prepare(
      "SELECT model_id, prompt_version, retrieval_version, created_at FROM analysis_runs WHERE scan_id = ? ORDER BY created_at DESC",
    )
      .bind(scanId)
      .all<AnalysisRunRow>(),
    context.env.DB.prepare(
      "SELECT payload_json, expires_at FROM reports WHERE scan_id = ? AND expires_at > ?",
    )
      .bind(scanId, nowIso)
      .first<ReportLinkRow>(),
  ]);

  return context.json({
    scanId: scan.id,
    createdAt: scan.created_at,
    jurisdiction: scan.jurisdiction,
    category: scan.category,
    state: scan.state,
    expiresAt: scan.expires_at,
    urlHashPrefix: truncateHash(scan.url_hash),
    coverage: parseCoverage(scan.coverage_json),
    severityCounts: severityCounts(severityResult.results ?? []),
    analysisRuns: (analysisResult.results ?? []).map((row) => ({
      modelId: row.model_id,
      promptVersion: row.prompt_version,
      retrievalVersion: row.retrieval_version,
      createdAt: row.created_at,
    })),
    reportUrl: report ? reportUrlFromPayload(report.payload_json) : null,
  });
});

adminRouter.get("/audit", async (context) => {
  const query = context.req.query();
  const limit = clampLimit(query.limit);
  const rawFrom = pickString(query.from);
  const rawTo = pickString(query.to);
  if ((rawFrom && !isIsoDate(rawFrom)) || (rawTo && !isIsoDate(rawTo))) {
    return context.json({ code: "INVALID_DATE" }, 400);
  }
  const from = rawFrom ?? daysAgoIso(7);
  const to = rawTo;
  const actor = pickString(query.actor);
  const decision = toStoredDecision(pickString(query.decision));
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) {
    return context.json({ code: "INVALID_CURSOR" }, 400);
  }
  if (query.decision && !decision) {
    return context.json({ code: "INVALID_DECISION" }, 400);
  }

  const filters = ["e.created_at >= ?"];
  const bindings: unknown[] = [from];
  if (to) {
    filters.push("e.created_at <= ?");
    bindings.push(to);
  }
  if (actor) {
    filters.push("e.actor = ?");
    bindings.push(actor);
  }
  if (decision) {
    filters.push("e.decision = ?");
    bindings.push(decision);
  }
  if (cursor) {
    filters.push("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit + 1);

  const result = await context.env.DB.prepare(
    "SELECT e.id, e.created_at, e.actor, e.decision, e.reason, d.title AS document_title, d.jurisdiction " +
      "FROM legal_review_events e LEFT JOIN legal_documents d ON d.id = e.document_id " +
      `WHERE ${filters.join(" AND ")} ` +
      "ORDER BY e.created_at DESC, e.id DESC LIMIT ?",
  )
    .bind(...bindings)
    .all<AuditListRow>();

  const rows = result.results ?? [];
  const pageRows = rows.slice(0, limit);
  const nextRow = rows.length > limit ? pageRows[pageRows.length - 1] : null;

  return context.json({
    events: pageRows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actor: row.actor,
      documentTitle: row.document_title ?? "Unknown document",
      jurisdiction: row.jurisdiction ?? "unknown",
      decision: toPublicDecision(row.decision),
      reason: row.reason,
    })),
    summary: summarizeAudit(pageRows),
    nextCursor: nextRow ? encodeCursor({ createdAt: nextRow.created_at, id: nextRow.id }) : null,
  });
});

adminRouter.get("/legal/pending", async (context) => {
  const result = await context.env.DB.prepare(
    "SELECT id, jurisdiction, source_url, title, retrieved_at, source_hash, effective_from, effective_to " +
      "FROM legal_documents " +
      "WHERE status = 'pending_review' " +
      "ORDER BY retrieved_at DESC LIMIT 100",
  )
    .bind()
    .all<PendingDocumentRow>();
  const docs = (result.results ?? []).map((r) => ({
    id: r.id,
    jurisdiction: r.jurisdiction,
    sourceUrl: r.source_url,
    title: r.title,
    retrievedAt: r.retrieved_at,
    sourceHash: r.source_hash,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }));
  return context.json(docs);
});

adminRouter.get("/legal/:documentId", async (context) => {
  const documentId = context.req.param("documentId");
  if (!documentId || documentId.length > 256) {
    return context.json({ code: "INVALID_DOCUMENT_ID" }, 400);
  }
  const docRow = await context.env.DB.prepare(
    "SELECT id, jurisdiction, source_url, title, retrieved_at, source_hash, effective_from, effective_to " +
      "FROM legal_documents WHERE id = ?",
  )
    .bind(documentId)
    .first<PendingDocumentRow>();
  if (!docRow) {
    return context.json({ code: "NOT_FOUND" }, 404);
  }

  const [provResult, relResult, auditResult] = await Promise.all([
    context.env.DB.prepare(
      "SELECT id, document_id, article, clause, text, categories_json FROM legal_provisions WHERE document_id = ?",
    )
      .bind(documentId)
      .all<ProvisionRow>(),
    context.env.DB.prepare(
      "SELECT id, from_document_id, to_document_id, relation_type FROM document_relations WHERE from_document_id = ?",
    )
      .bind(documentId)
      .all<RelationRow>(),
    context.env.DB.prepare(
      "SELECT actor, decision, reason, created_at FROM legal_review_events WHERE document_id = ? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(documentId)
      .all<AuditRow>(),
  ]);

  const provisions = (provResult.results ?? []).map((p) => ({
    id: p.id,
    article: p.article,
    clause: p.clause,
    text: p.text,
    categories: parseCategories(p.categories_json),
  }));

  const relations = (relResult.results ?? []).map((r) => ({
    id: r.id,
    type: r.relation_type,
    targetDocumentId: r.to_document_id,
  }));

  const audit = (auditResult.results ?? []).map((a) => ({
    actor: a.actor,
    decision: a.decision,
    reason: a.reason,
    createdAt: a.created_at,
  }));

  return context.json({
    id: docRow.id,
    jurisdiction: docRow.jurisdiction,
    sourceUrl: docRow.source_url,
    title: docRow.title,
    retrievedAt: docRow.retrieved_at,
    sourceHash: docRow.source_hash,
    effectiveFrom: docRow.effective_from,
    effectiveTo: docRow.effective_to,
    provisions,
    relations,
    audit,
  });
});

adminRouter.post("/legal/:documentId/review", async (context) => {
  const documentId = context.req.param("documentId");
  if (!documentId || documentId.length > 256) {
    return context.json({ code: "INVALID_DOCUMENT_ID" }, 400);
  }

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ code: "INVALID_JSON" }, 400);
  }
  const decision = pickString((body as { decision?: unknown })?.decision);
  const reason = pickString((body as { reason?: unknown })?.reason);
  if (!decision || (decision !== "approve" && decision !== "reject")) {
    return context.json({ code: "INVALID_DECISION" }, 400);
  }
  if (!reason || reason.length < 3) {
    return context.json({ code: "INVALID_REASON" }, 400);
  }

  // Confirm the document exists and is still in pending_review. This
  // prevents a duplicate approve/reject from racing past an earlier
  // decision.
  const current = await context.env.DB.prepare("SELECT status FROM legal_documents WHERE id = ?")
    .bind(documentId)
    .first<{ status: string }>();
  if (!current) {
    return context.json({ code: "NOT_FOUND" }, 404);
  }
  if (current.status !== "pending_review") {
    return context.json(
      {
        code: "ALREADY_REVIEWED",
        currentStatus: current.status,
      },
      409,
    );
  }

  const newStatus = decision === "approve" ? "approved" : "rejected";
  const actor = RESOLVED_ACTOR(context.req.raw);
  const eventId = `evt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE legal_documents SET status = ? WHERE id = ? AND status = 'pending_review'",
    ).bind(newStatus, documentId),
    context.env.DB.prepare(
      "INSERT INTO legal_review_events (id, document_id, actor, decision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(eventId, documentId, actor, decision, reason, now),
  ]);

  // Audit logging NEVER logs the URL path or document id (privacy), only
  // the actor + decision + reason length.
  console.log(
    JSON.stringify({
      level: "info",
      event: "admin.review.submitted",
      actor,
      decision,
      reasonLength: reason.length,
      hasDocumentId: documentId.length,
    }),
  );

  return context.json({ ok: true, status: newStatus, eventId, actor, decidedAt: now });
});

const pickString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const countValue = async (
  rowPromise: Promise<CountRow | null>,
  key: keyof CountRow,
): Promise<number> => {
  const row = await rowPromise;
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const metricTile = (
  key: UsageMetricKey,
  label: string,
  value: number,
  delta?: number,
): { key: UsageMetricKey; label: string; value: number; delta?: number } => ({
  key,
  label,
  value,
  ...(delta === undefined ? {} : { delta }),
});

const truncateHash = (hash: string | null): string => (hash ? hash.slice(0, 12) : "unknown");

const toAdminScanSummary = (row: AdminScanListRow) => ({
  scanId: row.id,
  createdAt: row.created_at,
  jurisdiction: row.jurisdiction,
  category: row.category,
  state: row.state,
  expiresAt: row.expires_at,
  urlHashPrefix: truncateHash(row.url_hash),
  pagesDone: row.pages_done ?? 0,
  totalPages: row.total_pages ?? 0,
});

const parseCoverage = (raw: string): { fetched: string[]; failed: string[]; skipped: string[] } => {
  const safeStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      fetched: safeStringArray(parsed.fetched),
      failed: safeStringArray(parsed.failed),
      skipped: safeStringArray(parsed.skipped),
    };
  } catch {
    return { fetched: [], failed: [], skipped: [] };
  }
};

const severityCounts = (
  rows: FindingSeverityRow[],
): { high: number; review: number; pass: number } => {
  const counts = { high: 0, review: 0, pass: 0 };
  for (const row of rows) {
    if (row.severity === "high" || row.severity === "review" || row.severity === "pass") {
      counts[row.severity] = row.n;
    }
  }
  return counts;
};

const reportUrlFromPayload = (payloadJson: string): string | null => {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload._reportToken === "string" ? `/vi/report/${payload._reportToken}` : null;
  } catch {
    return null;
  }
};

const daysAgoIso = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

const clampLimit = (raw: string | undefined): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 100);
};

const toStoredDecision = (decision: string | null): "approve" | "reject" | null => {
  if (decision === "approved" || decision === "approve") return "approve";
  if (decision === "rejected" || decision === "reject") return "reject";
  return null;
};

const toPublicDecision = (decision: string): "approved" | "rejected" | "pending" => {
  if (decision === "approve" || decision === "approved") return "approved";
  if (decision === "reject" || decision === "rejected") return "rejected";
  return "pending";
};

const summarizeAudit = (
  rows: AuditListRow[],
): { total: number; approved: number; rejected: number; pending: number } => {
  const summary = { total: rows.length, approved: 0, rejected: 0, pending: 0 };
  for (const row of rows) {
    summary[toPublicDecision(row.decision)] += 1;
  }
  return summary;
};

const isIsoDate = (value: string): boolean => {
  const time = Date.parse(value);
  return Number.isFinite(time);
};

const encodeCursor = (cursor: AuditCursor): string =>
  btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const decodeCursor = (raw: string): AuditCursor | null => {
  try {
    const padded = raw
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as AuditCursor).createdAt === "string" &&
      typeof (parsed as AuditCursor).id === "string" &&
      isIsoDate((parsed as AuditCursor).createdAt)
    ) {
      return parsed as AuditCursor;
    }
  } catch {
    // fall through
  }
  return null;
};

const parseCategories = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // fall through
  }
  return [];
};
