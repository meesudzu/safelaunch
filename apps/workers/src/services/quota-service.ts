import { isValidRedeemCodeShape } from "./redeem-codes";
import { DuplicateGrantError, type RedeemRepository } from "@safelaunch/db";

export const toQuotaDay = (iso: string): string => iso.slice(0, 10);

export interface ScanLookup {
  (
    domainKey: string,
    quotaDay: string,
    terminalStates: readonly string[],
  ): Promise<{
    id: string;
    state: string;
    status: string | null;
    createdAt: string;
    expiresAt: string;
  } | null>;
}

export interface ReportGet {
  (scanId: string): Promise<{ payloadJson: string } | null>;
}

export interface ResolveScanDeps {
  domainKey: string;
  quotaDay: string;
  now: string;
  redeemCode: string | null;
  redeemRepo: Pick<RedeemRepository, "findByHash" | "applyGrant">;
  scanLookup: ScanLookup;
  reportGet: ReportGet;
  hashCode: (plaintext: string) => Promise<string>;
  buildReportUrl?: (token: string) => string;
  generateGrantId?: () => string;
}

export type ResolveScanResult =
  | { kind: "fresh"; codeId: string | null }
  | {
      kind: "cached";
      originalScanId: string;
      state: string;
      status: string | undefined;
      reportUrl: string | null;
      message: string;
      createdAt: string;
      expiresAt: string;
    }
  | {
      kind: "rejected";
      reason: "INVALID_REDEEM_CODE" | "REDEEM_CODE_EXPIRED" | "REDEEM_CODE_ALREADY_USED";
    };

const TERMINAL_STATES = ["completed", "partial", "failed"] as const;

const ok = (codeId: string | null): Extract<ResolveScanResult, { kind: "fresh" }> => ({
  kind: "fresh",
  codeId,
});

export const resolveScanRequest = async (deps: ResolveScanDeps): Promise<ResolveScanResult> => {
  const prior = await deps.scanLookup(deps.domainKey, deps.quotaDay, TERMINAL_STATES);

  // No prior scan today: a redeem code is unnecessary.
  if (!prior) {
    if (deps.redeemCode) {
      // Still validate the code shape so a malformed code doesn't pass.
      if (!isValidRedeemCodeShape(deps.redeemCode)) {
        return { kind: "rejected", reason: "INVALID_REDEEM_CODE" };
      }
      const codeHash = await deps.hashCode(deps.redeemCode);
      const code = await deps.redeemRepo.findByHash(codeHash);
      if (!code || code.revokedAt !== null || code.expiresAt <= deps.now) {
        return { kind: "rejected", reason: "REDEEM_CODE_EXPIRED" };
      }
      const grantId = deps.generateGrantId ? deps.generateGrantId() : `rg_${crypto.randomUUID()}`;
      await deps.redeemRepo.applyGrant({
        id: grantId, codeId: code.id,
        domainKey: deps.domainKey, quotaDay: deps.quotaDay, grantedAt: deps.now,
      });
      return ok(code.id);
    }
    return ok(null);
  }

  // Prior scan today exists; user must either:
  //  - accept the cached result, OR
  //  - present a valid, unused-on-this-domain redeem code.
  if (!deps.redeemCode) {
    return await cachedResponse(prior, deps);
  }

  if (!isValidRedeemCodeShape(deps.redeemCode)) {
    return { kind: "rejected", reason: "INVALID_REDEEM_CODE" };
  }

  const codeHash = await deps.hashCode(deps.redeemCode);
  const code = await deps.redeemRepo.findByHash(codeHash);
  if (!code || code.revokedAt != null) {
    return { kind: "rejected", reason: "REDEEM_CODE_EXPIRED" };
  }
  if (code.expiresAt <= deps.now) {
    return { kind: "rejected", reason: "REDEEM_CODE_EXPIRED" };
  }

  try {
    const grantId = deps.generateGrantId ? deps.generateGrantId() : `rg_${crypto.randomUUID()}`;
    await deps.redeemRepo.applyGrant({
      id: grantId, codeId: code.id,
      domainKey: deps.domainKey, quotaDay: deps.quotaDay, grantedAt: deps.now,
    });
  } catch (cause) {
    if (cause instanceof DuplicateGrantError) {
      return { kind: "rejected", reason: "REDEEM_CODE_ALREADY_USED" };
    }
    throw cause;
  }

  return ok(code.id);
};

const cachedResponse = async (
  prior: NonNullable<Awaited<ReturnType<ScanLookup>>>,
  deps: ResolveScanDeps,
): Promise<Extract<ResolveScanResult, { kind: "cached" }>> => {
  let reportUrl: string | null = null;
  if (prior.state !== "failed") {
    const report = await deps.reportGet(prior.id);
    if (report) {
      try {
        const payload = JSON.parse(report.payloadJson) as Record<string, unknown>;
        const token = typeof payload._reportToken === "string" ? payload._reportToken : null;
        if (token && deps.buildReportUrl) {
          reportUrl = deps.buildReportUrl(token);
        }
      } catch {
        // Malformed payload — fall through with reportUrl=null.
      }
    }
  }
  const message = prior.state === "failed" ? "scan.cached.failed" : "scan.cached.used";
  return {
    kind: "cached",
    originalScanId: prior.id,
    state: prior.state,
    status: prior.status ?? undefined,
    reportUrl,
    message,
    createdAt: prior.createdAt,
    expiresAt: prior.expiresAt,
  };
};
