import { Hono } from "hono";
import { constantTimeEquals } from "./reports";

/**
 * Admin legal-review endpoints. Access control lives at the Cloudflare
 * Access layer (the `/admin/*` paths are gated by an Access application
 * that issues a JWT to the browser). The Worker trusts the validated
 * claims forwarded by Cloudflare:
 *
 *   - `cf-access-authenticated-user-email`  → human reviewer, used as
 *     the audit `actor` directly.
 *   - `cf-access-client-id` / `cf-access-client-secret` → service token
 *     (CI-driven review). Only honored when `ADMIN_SERVICE_TOKEN_CLIENT_ID`
 *     + `ADMIN_SERVICE_TOKEN_CLIENT_SECRET` are configured as Worker
 *     secrets; the request must present a matching pair. The audit actor
 *     is recorded as `service-token:<clientId>` so CI-driven decisions are
 *     distinguishable from human ones.
 *
 * When neither auth path resolves and no service-token secrets are
 * configured (local dev, no Access app in front), we fall back to a
 * stable placeholder so audit rows still record *some* actor. Once
 * service-token secrets ARE configured, an unresolved request is
 * rejected with 401 — the upstream Access policy is no longer the only
 * gate for review-submission.
 */

export interface AdminEnv {
  DB: D1Database;
  ADMIN_SERVICE_TOKEN_CLIENT_ID?: string;
  ADMIN_SERVICE_TOKEN_CLIENT_SECRET?: string;
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

/**
 * Resolves the audit actor for a review submission, or `null` if the
 * request cannot be authenticated. Returns `null` only when service-token
 * secrets are configured but the presented credentials don't match —
 * callers must reject that case with 401.
 */
const resolveActor = (request: Request, env: AdminEnv): string | null => {
  const humanEmail = request.headers.get("cf-access-authenticated-user-email");
  if (humanEmail) return humanEmail;

  const { ADMIN_SERVICE_TOKEN_CLIENT_ID, ADMIN_SERVICE_TOKEN_CLIENT_SECRET } = env;
  if (!ADMIN_SERVICE_TOKEN_CLIENT_ID || !ADMIN_SERVICE_TOKEN_CLIENT_SECRET) {
    // No service-token secrets configured (local dev, no Access app in
    // front) — fall back to a stable placeholder so audit rows still
    // record *some* actor.
    return "local-dev-reviewer";
  }

  const clientId = request.headers.get("cf-access-client-id");
  const clientSecret = request.headers.get("cf-access-client-secret");
  if (
    clientId &&
    clientSecret &&
    constantTimeEquals(clientId, ADMIN_SERVICE_TOKEN_CLIENT_ID) &&
    constantTimeEquals(clientSecret, ADMIN_SERVICE_TOKEN_CLIENT_SECRET)
  ) {
    return `service-token:${clientId}`;
  }

  return null;
};

export const adminRouter = new Hono<{ Bindings: AdminEnv }>();

adminRouter.get("/legal/pending", async (context) => {
  const result = await context.env.DB
    .prepare(
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
  const docRow = await context.env.DB
    .prepare(
      "SELECT id, jurisdiction, source_url, title, retrieved_at, source_hash, effective_from, effective_to " +
        "FROM legal_documents WHERE id = ?",
    )
    .bind(documentId)
    .first<PendingDocumentRow>();
  if (!docRow) {
    return context.json({ code: "NOT_FOUND" }, 404);
  }

  const [provResult, relResult, auditResult] = await Promise.all([
    context.env.DB
      .prepare(
        "SELECT id, document_id, article, clause, text, categories_json FROM legal_provisions WHERE document_id = ?",
      )
      .bind(documentId)
      .all<ProvisionRow>(),
    context.env.DB
      .prepare(
        "SELECT id, from_document_id, to_document_id, relation_type FROM document_relations WHERE from_document_id = ?",
      )
      .bind(documentId)
      .all<RelationRow>(),
    context.env.DB
      .prepare(
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
  const actor = resolveActor(context.req.raw, context.env);
  if (!actor) {
    return context.json({ code: "UNAUTHORIZED" }, 401);
  }

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
  const current = await context.env.DB
    .prepare("SELECT status FROM legal_documents WHERE id = ?")
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
  const eventId = `evt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await context.env.DB.batch([
    context.env.DB
      .prepare(
        "UPDATE legal_documents SET status = ? WHERE id = ? AND status = 'pending_review'",
      )
      .bind(newStatus, documentId),
    context.env.DB
      .prepare(
        "INSERT INTO legal_review_events (id, document_id, actor, decision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(eventId, documentId, actor, decision, reason, now),
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
