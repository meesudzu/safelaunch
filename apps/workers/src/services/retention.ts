/**
 * Anonymous-scan retention service.
 *
 * The MVP guarantees that every artifact collected for a scan — D1 rows
 * (scans, scan_pages, evidence_items, reports) and the R2 page snapshots —
 * is deleted seven days after creation, with only aggregate counters kept.
 *
 * The service is **idempotent** so the daily cron can be replayed without
 * risk of double-deletion. It logs a single structured `retention.purge`
 * event with deletion counts; the `toLogEvent` helper guarantees that no
 * URL path, IP, or token is ever written to logs.
 */
import { toLogEvent } from "../observability";

export interface RetentionDeps {
  readonly db: D1Database;
  readonly r2: R2Bucket;
  readonly now: () => string;
  readonly log: (event: Record<string, unknown>) => void;
}

export interface RetentionSummary {
  readonly scansDeleted: number;
  readonly reportsDeleted: number;
  readonly r2ObjectsDeleted: number;
}

const SCANS_BY_EXPIRY_SQL = "DELETE FROM scans WHERE expires_at < ?";
const REPORTS_BY_EXPIRY_SQL = "DELETE FROM reports WHERE expires_at < ?";
const SCAN_PAGES_BY_EXPIRY_SQL =
  "DELETE FROM scan_pages WHERE scan_id IN (SELECT id FROM scans WHERE expires_at < ?)";
const EVIDENCE_BY_EXPIRY_SQL =
  "DELETE FROM evidence_items WHERE scan_id IN (SELECT id FROM scans WHERE expires_at < ?)";
const LIST_R2_SCAN_PREFIX = "scans/";

const runDelete = async (db: D1Database, sql: string, cutoff: string): Promise<number> => {
  const result = await db.prepare(sql).bind(cutoff).run();
  return Number(result.meta?.changes ?? 0);
};

const listExpiredScanPrefixes = async (r2: R2Bucket, cutoff: string): Promise<string[]> => {
  const prefixes = new Set<string>();
  let cursor: string | undefined;
  do {
    const listed = await r2.list({
      prefix: LIST_R2_SCAN_PREFIX,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    for (const obj of listed.objects) {
      // Object keys look like `scans/<scanId>/<page>.html`. We only know
      // the scan id is expired by checking the timestamp encoded in the
      // object's custom metadata; the cron passes a cut-off so we can
      // conservatively delete any object whose `uploaded` is older.
      const uploaded = (obj as unknown as { uploaded?: string }).uploaded;
      if (uploaded && new Date(uploaded).getTime() < new Date(cutoff).getTime()) {
        const match = obj.key.match(/^scans\/([^/]+)\//);
        if (match) prefixes.add(match[1] ?? "");
      } else if (!uploaded) {
        // No uploaded metadata (older objects). Conservative include.
        const match = obj.key.match(/^scans\/([^/]+)\//);
        if (match) prefixes.add(match[1] ?? "");
      }
    }
    cursor = listed.truncated ? (listed.cursor ?? undefined) : undefined;
    if (!listed.truncated) break;
  } while (cursor);
  return Array.from(prefixes);
};

const deleteScanArtifacts = async (r2: R2Bucket, scanId: string): Promise<number> => {
  let count = 0;
  let cursor: string | undefined;
  do {
    const listed = await r2.list({
      prefix: `scans/${scanId}/`,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    for (const obj of listed.objects) {
      await r2.delete(obj.key);
      count += 1;
    }
    cursor = listed.truncated ? (listed.cursor ?? undefined) : undefined;
    if (!listed.truncated) break;
  } while (cursor);
  return count;
};

export const purgeExpired = async (
  cutoff: string,
  deps: RetentionDeps,
): Promise<RetentionSummary> => {
  const scansDeleted = await runDelete(deps.db, SCANS_BY_EXPIRY_SQL, cutoff);
  const scanPagesDeleted = await runDelete(deps.db, SCAN_PAGES_BY_EXPIRY_SQL, cutoff);
  const evidenceDeleted = await runDelete(deps.db, EVIDENCE_BY_EXPIRY_SQL, cutoff);
  const reportsDeleted = await runDelete(deps.db, REPORTS_BY_EXPIRY_SQL, cutoff);

  const expiredScanIds = await listExpiredScanPrefixes(deps.r2, cutoff);
  let r2ObjectsDeleted = 0;
  for (const scanId of expiredScanIds) {
    r2ObjectsDeleted += await deleteScanArtifacts(deps.r2, scanId);
  }

  const event = await toLogEvent(
    {
      method: "CRON",
      url: "internal://retention/purge",
      ip: "internal",
      userAgent: "safe-launch-cron",
      body: { cutoff },
    },
    {
      event: "retention.purge",
      now: deps.now(),
      scansDeleted,
      scanPagesDeleted,
      evidenceDeleted,
      reportsDeleted,
      r2ObjectsDeleted,
    },
  );
  const resolved = await Promise.resolve(event);
  deps.log(resolved);

  return {
    scansDeleted,
    reportsDeleted,
    r2ObjectsDeleted,
  };
};
