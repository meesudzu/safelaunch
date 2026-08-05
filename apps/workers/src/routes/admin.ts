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
  ARTIFACTS?: R2Bucket;
  LEGAL_INDEX?: VectorizeIndex;
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
  document_id: string;
  document_title: string | null;
  jurisdiction: string | null;
}

type AuditDecision = "approved" | "rejected" | "pending";

const AUDIT_PAGE_SIZE = 50;

const normalizeDecision = (decision: string): AuditDecision => {
  if (decision === "approve" || decision === "approved") return "approved";
  if (decision === "reject" || decision === "rejected") return "rejected";
  return "pending";
};

const encodeAuditCursor = (row: Pick<AuditListRow, "created_at" | "id">): string =>
  btoa(JSON.stringify({ createdAt: row.created_at, id: row.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const decodeAuditCursor = (raw: string): { createdAt: string; id: string } | null => {
  try {
    const base64 = raw.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(base64)) as { createdAt?: unknown; id?: unknown };
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      parsed.id.length > 256
    ) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
};

const validIsoDate = (value: string): boolean =>
  value.length <= 64 && !Number.isNaN(Date.parse(value));

const RESOLVED_ACTOR = (request: Request): string => {
  // Cloudflare Access forwards the authenticated user's email as a header.
  // In local dev (no Access app), fall back to a stable placeholder so
  // audit rows still record *some* actor.
  return request.headers.get("cf-access-authenticated-user-email") ?? "local-dev-reviewer";
};

export const adminRouter = new Hono<{ Bindings: AdminEnv }>();

type HealthStatus = "available" | "degraded" | "unknown";
type HealthSection = {
  status: HealthStatus;
  checkedAt: string;
  reason?: string;
  metrics?: Record<string, number | string | null>;
};

adminRouter.get("/health", async (context) => {
  const checkedAt = new Date().toISOString();
  const safe = async (
    probe: () => Promise<Record<string, number | string | null>>,
  ): Promise<HealthSection> => {
    try {
      return { status: "available", checkedAt, metrics: await probe() };
    } catch {
      return { status: "degraded", checkedAt, reason: "probe_failed" };
    }
  };
  const d1 = safe(async () => {
    const row = await context.env.DB.prepare(
      `SELECT
      (SELECT COUNT(*) FROM scans) AS scans,
      (SELECT COUNT(*) FROM reports) AS reports,
      (SELECT COUNT(*) FROM legal_documents) AS legal_documents,
      (SELECT COUNT(*) FROM legal_review_events) AS review_events,
      (SELECT MIN(created_at) FROM scans WHERE expires_at > ?) AS oldest_active_scan,
      (SELECT MIN(retrieved_at) FROM legal_documents WHERE status = 'pending_review') AS oldest_pending_review`,
    )
      .bind(checkedAt)
      .first<Record<string, number | string | null>>();
    if (!row) throw new Error("missing");
    return row;
  });
  const r2 = context.env.ARTIFACTS
    ? safe(async () => {
        let cursor: string | undefined;
        let objects = 0;
        let bytes = 0;
        do {
          const page = await context.env.ARTIFACTS!.list({
            prefix: "scans/",
            ...(cursor ? { cursor } : {}),
          });
          objects += page.objects.length;
          bytes += page.objects.reduce((sum, item) => sum + item.size, 0);
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return { objects, bytes };
      })
    : Promise.resolve({
        status: "unknown",
        checkedAt,
        reason: "binding_not_configured",
      } as HealthSection);
  const vectorize = context.env.LEGAL_INDEX
    ? safe(async () => {
        const info = await context.env.LEGAL_INDEX!.describe();
        return { vectorCount: info.vectorsCount };
      })
    : Promise.resolve({
        status: "unknown",
        checkedAt,
        reason: "binding_not_configured",
      } as HealthSection);
  const [d1Result, r2Result, vectorResult] = await Promise.all([d1, r2, vectorize]);
  const unknown = (): HealthSection => ({
    status: "unknown",
    checkedAt,
    reason: "analytics_not_configured",
  });
  return context.json({
    checkedAt,
    sections: {
      d1: d1Result,
      r2: r2Result,
      vectorize: vectorResult,
      queue: unknown(),
      workflow: unknown(),
      durableObject: unknown(),
      workersAi: unknown(),
    },
  });
});

interface UsageMetricsRow {
  scans_current: number;
  scans_previous: number;
  sites_current: number;
  sites_previous: number;
  reports_current: number;
  reports_previous: number;
  reviewers_current: number;
  reviewers_previous: number;
  unhashed_current: number;
}

adminRouter.get("/metrics/usage", async (context) => {
  const now = new Date();
  const currentFrom = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const previousFrom = new Date(now.getTime() - 48 * 60 * 60 * 1_000).toISOString();
  const until = now.toISOString();
  const row = await context.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM scans WHERE created_at >= ? AND created_at < ?) AS scans_current,
      (SELECT COUNT(*) FROM scans WHERE created_at >= ? AND created_at < ?) AS scans_previous,
      (SELECT COUNT(DISTINCT url_hash) FROM scans WHERE created_at >= ? AND created_at < ? AND url_hash IS NOT NULL) AS sites_current,
      (SELECT COUNT(DISTINCT url_hash) FROM scans WHERE created_at >= ? AND created_at < ? AND url_hash IS NOT NULL) AS sites_previous,
      (SELECT COUNT(*) FROM reports WHERE opened_at >= ? AND opened_at < ?) AS reports_current,
      (SELECT COUNT(*) FROM reports WHERE opened_at >= ? AND opened_at < ?) AS reports_previous,
      (SELECT COUNT(DISTINCT actor) FROM legal_review_events WHERE created_at >= ? AND created_at < ?) AS reviewers_current,
      (SELECT COUNT(DISTINCT actor) FROM legal_review_events WHERE created_at >= ? AND created_at < ?) AS reviewers_previous,
      (SELECT COUNT(*) FROM scans WHERE created_at >= ? AND created_at < ? AND url_hash IS NULL) AS unhashed_current`,
  )
    .bind(
      currentFrom,
      until,
      previousFrom,
      currentFrom,
      currentFrom,
      until,
      previousFrom,
      currentFrom,
      currentFrom,
      until,
      previousFrom,
      currentFrom,
      currentFrom,
      until,
      previousFrom,
      currentFrom,
      currentFrom,
      until,
    )
    .first<UsageMetricsRow>();
  if (!row) return context.json({ code: "METRICS_UNAVAILABLE" }, 503);
  const metric = (value: number, previous: number) => ({
    value,
    previous,
    delta: value - previous,
  });
  return context.json({
    window: { from: currentFrom, to: until, previousFrom },
    scans: metric(row.scans_current, row.scans_previous),
    uniqueSites: metric(row.sites_current, row.sites_previous),
    reportsOpened: metric(row.reports_current, row.reports_previous),
    activeReviewers: metric(row.reviewers_current, row.reviewers_previous),
    uniqueSitesComplete: row.unhashed_current === 0,
  });
});

interface SeverityCountRow {
  severity: string;
  category: string;
  count: number;
}
const severityOrder = ["pass", "review", "high"] as const;

adminRouter.get("/metrics/compliance", async (context) => {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const [countsResult, version] = await Promise.all([
    context.env.DB.prepare(
      `SELECT f.severity, s.category, COUNT(*) AS count
      FROM findings f JOIN scans s ON s.id = f.scan_id
      WHERE s.created_at >= ? AND s.created_at < ?
      GROUP BY f.severity, s.category ORDER BY s.category, f.severity`,
    )
      .bind(from, now.toISOString())
      .all<SeverityCountRow>(),
    context.env.DB.prepare(
      `SELECT ar.rule_version_id, ar.prompt_version, ar.retrieval_version
      FROM analysis_runs ar ORDER BY ar.created_at DESC LIMIT 1`,
    )
      .bind()
      .first<{ rule_version_id: string; prompt_version: string; retrieval_version: string }>(),
  ]);
  const rows = countsResult.results ?? [];
  const totals = Object.fromEntries(
    severityOrder.map((severity) => [
      severity,
      rows
        .filter((row) => row.severity === severity)
        .reduce((sum, row) => sum + Number(row.count), 0),
    ]),
  );
  const categories = [...new Set(rows.map((row) => row.category))].sort().map((category) => {
    const counts = Object.fromEntries(
      severityOrder.map((severity) => [
        severity,
        rows.find((row) => row.category === category && row.severity === severity)?.count ?? 0,
      ]),
    );
    const total = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);
    let cumulative = 0;
    let median: string | null = null;
    for (const severity of severityOrder) {
      cumulative += Number(counts[severity]);
      if (total > 0 && cumulative >= Math.ceil(total / 2)) {
        median = severity;
        break;
      }
    }
    return { category, counts, total, medianSeverity: median };
  });
  return context.json({
    window: { from, to: now.toISOString() },
    severityOrder,
    totals,
    categories,
    version: version ?? null,
  });
});

interface AdminScanListRow {
  id: string;
  url_hash: string | null;
  jurisdiction: string;
  category: string;
  state: string;
  created_at: string;
  expires_at: string;
  pages_done: number;
  pages_total: number;
}
const scanStates = new Set([
  "queued",
  "fetching",
  "extracting",
  "retrieving",
  "evaluating",
  "reporting",
  "completed",
  "partial",
  "failed",
]);
const terminalStates = ["completed", "partial", "failed"];

adminRouter.get("/scans", async (context) => {
  const query = context.req.query();
  const fromInput = query.from ?? new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const toInput = query.to;
  const cursor = query.cursor ? decodeAuditCursor(query.cursor) : null;
  if (
    !validIsoDate(fromInput) ||
    (toInput && !validIsoDate(toInput)) ||
    (query.state && !scanStates.has(query.state)) ||
    (query.live && query.live !== "true") ||
    (query.cursor && !cursor)
  )
    return context.json({ code: "INVALID_SCAN_FILTERS" }, 400);
  const from = new Date(fromInput).toISOString();
  const to = toInput ? new Date(toInput).toISOString() : null;
  if (to && from > to) return context.json({ code: "INVALID_SCAN_FILTERS" }, 400);
  const conditions = ["s.created_at >= ?"];
  const bindings: unknown[] = [from];
  if (to) {
    conditions.push("s.created_at <= ?");
    bindings.push(to);
  }
  if (query.state) {
    conditions.push("s.state = ?");
    bindings.push(query.state);
  }
  if (query.jurisdiction) {
    conditions.push("s.jurisdiction = ?");
    bindings.push(query.jurisdiction);
  }
  if (query.category) {
    conditions.push("s.category = ?");
    bindings.push(query.category);
  }
  if (query.live === "true") {
    conditions.push("s.state NOT IN (?, ?, ?)");
    bindings.push(...terminalStates);
  }
  if (cursor) {
    conditions.push("(s.created_at < ? OR (s.created_at = ? AND s.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(51);
  const result = await context.env.DB.prepare(
    `SELECT s.id, s.url_hash, s.jurisdiction, s.category, s.state, s.created_at, s.expires_at,
    (SELECT COUNT(*) FROM scan_pages p WHERE p.scan_id = s.id AND p.state IN ('fetched','failed','skipped')) AS pages_done,
    (SELECT COUNT(*) FROM scan_pages p WHERE p.scan_id = s.id) AS pages_total
    FROM scans s WHERE ${conditions.join(" AND ")} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
  )
    .bind(...bindings)
    .all<AdminScanListRow>();
  const rows = result.results ?? [];
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return context.json({
    items: page.map((row) => ({
      id: row.id,
      urlHash: row.url_hash?.slice(0, 12) ?? null,
      jurisdiction: row.jurisdiction,
      category: row.category,
      state: row.state,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      pagesDone: Number(row.pages_done),
      pagesTotal: Number(row.pages_total),
    })),
    nextCursor: rows.length > 50 && last ? encodeAuditCursor(last) : null,
    window: { from, to },
  });
});

adminRouter.get("/scans/:scanId", async (context) => {
  const scanId = context.req.param("scanId");
  if (!scanId || scanId.length > 256) return context.json({ code: "INVALID_SCAN_ID" }, 400);
  const scan = await context.env.DB.prepare(
    "SELECT id, url_hash, jurisdiction, category, state, coverage_json, analysis_version, created_at, expires_at FROM scans WHERE id = ?",
  )
    .bind(scanId)
    .first<{
      id: string;
      url_hash: string | null;
      jurisdiction: string;
      category: string;
      state: string;
      coverage_json: string;
      analysis_version: string;
      created_at: string;
      expires_at: string;
    }>();
  if (!scan) return context.json({ code: "NOT_FOUND" }, 404);
  const [pages, findings, runs, report] = await Promise.all([
    context.env.DB.prepare(
      "SELECT state, COUNT(*) AS count FROM scan_pages WHERE scan_id = ? GROUP BY state",
    )
      .bind(scanId)
      .all<{ state: string; count: number }>(),
    context.env.DB.prepare(
      "SELECT severity, COUNT(*) AS count FROM findings WHERE scan_id = ? GROUP BY severity",
    )
      .bind(scanId)
      .all<{ severity: string; count: number }>(),
    context.env.DB.prepare(
      "SELECT model_id, prompt_version, retrieval_version, rule_version_id, created_at FROM analysis_runs WHERE scan_id = ? ORDER BY created_at DESC LIMIT 20",
    )
      .bind(scanId)
      .all<Record<string, string>>(),
    context.env.DB.prepare(
      "SELECT scan_id, token_hash IS NOT NULL AS available, expires_at FROM reports WHERE scan_id = ?",
    )
      .bind(scanId)
      .first<{ scan_id: string; available: number; expires_at: string }>(),
  ]);
  const coverageRaw = JSON.parse(scan.coverage_json) as Record<string, unknown>;
  const coverage = Object.fromEntries(
    ["fetched", "failed", "skipped"].map((key) => [
      key,
      Array.isArray(coverageRaw[key]) ? coverageRaw[key].length : 0,
    ]),
  );
  return context.json({
    id: scan.id,
    urlHash: scan.url_hash?.slice(0, 12) ?? null,
    jurisdiction: scan.jurisdiction,
    category: scan.category,
    state: scan.state,
    coverage,
    analysisVersion: scan.analysis_version,
    createdAt: scan.created_at,
    expiresAt: scan.expires_at,
    pageStates: pages.results ?? [],
    findingSeverities: findings.results ?? [],
    analysisRuns: runs.results ?? [],
    report: report ? { available: Boolean(report.available), expiresAt: report.expires_at } : null,
  });
});

adminRouter.get("/audit", async (context) => {
  const query = context.req.query();
  const fromInput = query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const toInput = query.to;
  const actor = query.actor?.trim();
  const decision = query.decision as AuditDecision | undefined;
  const cursor = query.cursor ? decodeAuditCursor(query.cursor) : null;

  if (
    !validIsoDate(fromInput) ||
    (toInput !== undefined && !validIsoDate(toInput)) ||
    (actor !== undefined && (actor.length === 0 || actor.length > 320)) ||
    (decision !== undefined && !["approved", "rejected", "pending"].includes(decision)) ||
    (query.cursor !== undefined && cursor === null)
  ) {
    return context.json({ code: "INVALID_AUDIT_FILTERS" }, 400);
  }

  const from = new Date(fromInput).toISOString();
  const to = toInput === undefined ? undefined : new Date(toInput).toISOString();
  if (to !== undefined && from > to) {
    return context.json({ code: "INVALID_AUDIT_FILTERS" }, 400);
  }

  const conditions = ["e.created_at >= ?"];
  const bindings: unknown[] = [from];
  if (to !== undefined) {
    conditions.push("e.created_at <= ?");
    bindings.push(to);
  }
  if (actor !== undefined) {
    conditions.push("e.actor = ?");
    bindings.push(actor);
  }
  if (decision !== undefined) {
    if (decision === "approved") {
      conditions.push("e.decision IN (?, ?)");
      bindings.push("approved", "approve");
    } else if (decision === "rejected") {
      conditions.push("e.decision IN (?, ?)");
      bindings.push("rejected", "reject");
    } else {
      conditions.push("e.decision = ?");
      bindings.push("pending");
    }
  }
  if (cursor !== null) {
    conditions.push("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(AUDIT_PAGE_SIZE + 1);

  const sql = `SELECT e.id, e.document_id, e.actor, e.decision, e.reason, e.created_at,
    d.title AS document_title, d.jurisdiction
    FROM legal_review_events e
    LEFT JOIN legal_documents d ON d.id = e.document_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ?`;
  const result = await context.env.DB.prepare(sql)
    .bind(...bindings)
    .all<AuditListRow>();
  const rows = result.results ?? [];
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);

  return context.json({
    items: page.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      actor: row.actor,
      decision: normalizeDecision(row.decision),
      reason: row.reason,
      createdAt: row.created_at,
      documentTitle: row.document_title,
      jurisdiction: row.jurisdiction,
    })),
    nextCursor: rows.length > AUDIT_PAGE_SIZE && last ? encodeAuditCursor(last) : null,
    window: { from, to: to ?? null },
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
