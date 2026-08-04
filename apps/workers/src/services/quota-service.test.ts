import { describe, expect, it } from "vitest";
import { resolveScanRequest, toQuotaDay } from "./quota-service";
import { DuplicateGrantError, RedeemRepository } from "@safelaunch/db";

const H = (s: string): Promise<string> => Promise.resolve(s.length === 64 ? s : "h".repeat(64));

interface FakeCode {
  id: string;
  codeHash: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

const castRedeemRepo = (
  r: FakeRedeemRepo,
): Pick<RedeemRepository, "findByHash" | "applyGrant"> & FakeRedeemRepo =>
  r as unknown as Pick<RedeemRepository, "findByHash" | "applyGrant"> & FakeRedeemRepo;

interface FakeGrant {
  id: string;
  codeId: string;
  domainKey: string;
  quotaDay: string;
  grantedAt: string;
}

interface FakeScanRow {
  id: string;
  domainKey: string;
  quotaDay: string;
  state: string;
  status: string | null;
  createdAt: string;
  expiresAt: string;
}

class FakeRedeemRepo {
  codes: Record<string, FakeCode> = {};
  grants: FakeGrant[] = [];
  createCode = (c: FakeCode): Promise<FakeCode> =>
    Promise.resolve((this.codes[c.id] = { ...c, revokedAt: c.revokedAt ?? null }));
  findByHash = (h: string): Promise<FakeCode | null> =>
    Promise.resolve(Object.values(this.codes).find((c) => c.codeHash === h) ?? null);
  applyGrant = (g: FakeGrant): Promise<FakeGrant> => {
    const dup = this.grants.find(
      (x) => x.codeId === g.codeId && x.domainKey === g.domainKey && x.quotaDay === g.quotaDay,
    );
    if (dup) return Promise.reject(new DuplicateGrantError(g.codeId, g.domainKey, g.quotaDay));
    this.grants.push(g);
    return Promise.resolve(g);
  };
}

class FakeScanRepo {
  rows: FakeScanRow[] = [];
  lookup = (
    domainKey: string,
    day: string,
    terminal: readonly string[],
  ): Promise<FakeScanRow | null> => {
    return Promise.resolve(
      this.rows
        .filter(
          (r) => r.domainKey === domainKey && r.quotaDay === day && terminal.includes(r.state),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    );
  };
}

class FakeReportRepo {
  rows: Record<string, { payloadJson: string }> = {};
  get = (scanId: string): Promise<{ payloadJson: string } | null> =>
    Promise.resolve(this.rows[scanId] ?? null);
}

describe("toQuotaDay", () => {
  it("formats UTC date as YYYY-MM-DD", () => {
    expect(toQuotaDay("2026-08-03T17:00:00.000Z")).toBe("2026-08-03");
    expect(toQuotaDay("2026-08-03T23:59:59.999Z")).toBe("2026-08-03");
    expect(toQuotaDay("2026-08-04T00:00:01.000Z")).toBe("2026-08-04");
  });
});

describe("resolveScanRequest", () => {
  const now = "2026-08-03T10:00:00.000Z";
  const domainKey = "example.com";
  const day = "2026-08-03";

  it("returns fresh when no prior scan today", async () => {
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: null,
      redeemRepo: castRedeemRepo(new FakeRedeemRepo()),
      scanLookup: new FakeScanRepo().lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: H,
      generateGrantId: () => "rg_test",
    });
    expect(r.kind).toBe("fresh");
  });

  it("returns cached when a prior scan exists (no code)", async () => {
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "completed",
      status: "needs_review",
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const reportRepo = new FakeReportRepo();
    reportRepo.rows["scan_1"] = { payloadJson: JSON.stringify({ _reportToken: "tok1" }) };
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: null,
      redeemRepo: castRedeemRepo(new FakeRedeemRepo()),
      scanLookup: scanRepo.lookup,
      reportGet: reportRepo.get,
      hashCode: H,
      buildReportUrl: (t) => `https://example.com/report/${t}`,
    });
    expect(r.kind).toBe("cached");
    if (r.kind === "cached") {
      expect(r.originalScanId).toBe("scan_1");
      expect(r.reportUrl).toBe("https://example.com/report/tok1");
      expect(r.message).toBe("scan.cached.used");
    }
  });

  it("returns fresh when a valid redeem code is presented", async () => {
    const _redeemRepoInstance = new FakeRedeemRepo();
    const redeemRepo = _redeemRepoInstance as unknown as Pick<
      RedeemRepository,
      "findByHash" | "applyGrant"
    > &
      typeof _redeemRepoInstance;
    await redeemRepo.createCode({
      id: "rc_1",
      codeHash: "h".repeat(64),
      label: "l",
      createdBy: "a",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "completed",
      status: "needs_review",
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: "SL-A2K9-7X4P",
      redeemRepo,
      scanLookup: scanRepo.lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: () => Promise.resolve("h".repeat(64)),
      generateGrantId: () => "rg_test",
    });
    expect(r.kind).toBe("fresh");
    if (r.kind === "fresh") {
      expect(r.codeId).toBe("rc_1");
    }
    expect(redeemRepo.grants).toHaveLength(1);
  });

  it("rejects an expired code", async () => {
    const _redeemRepoInstance = new FakeRedeemRepo();
    const redeemRepo = _redeemRepoInstance as unknown as Pick<
      RedeemRepository,
      "findByHash" | "applyGrant"
    > &
      typeof _redeemRepoInstance;
    await redeemRepo.createCode({
      id: "rc_1",
      codeHash: "h".repeat(64),
      label: "l",
      createdBy: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
    });
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "completed",
      status: "needs_review",
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: "SL-A2K9-7X4P",
      redeemRepo,
      scanLookup: scanRepo.lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: () => Promise.resolve("h".repeat(64)),
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("REDEEM_CODE_EXPIRED");
  });

  it("rejects a revoked code", async () => {
    const _redeemRepoInstance = new FakeRedeemRepo();
    const redeemRepo = _redeemRepoInstance as unknown as Pick<
      RedeemRepository,
      "findByHash" | "applyGrant"
    > &
      typeof _redeemRepoInstance;
    await redeemRepo.createCode({
      id: "rc_1",
      codeHash: "h".repeat(64),
      label: "l",
      createdBy: "a",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      revokedAt: "2026-08-03T09:00:00.000Z",
    });
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "completed",
      status: "needs_review",
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: "SL-A2K9-7X4P",
      redeemRepo,
      scanLookup: scanRepo.lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: () => Promise.resolve("h".repeat(64)),
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("REDEEM_CODE_EXPIRED");
  });

  it("rejects a code already used for the same domain/day", async () => {
    const _redeemRepoInstance = new FakeRedeemRepo();
    const redeemRepo = _redeemRepoInstance as unknown as Pick<
      RedeemRepository,
      "findByHash" | "applyGrant"
    > &
      typeof _redeemRepoInstance;
    await redeemRepo.createCode({
      id: "rc_1",
      codeHash: "h".repeat(64),
      label: "l",
      createdBy: "a",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    await redeemRepo.applyGrant({
      id: "rg_1",
      codeId: "rc_1",
      domainKey,
      quotaDay: day,
      grantedAt: now,
    });
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "completed",
      status: "needs_review",
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: "SL-A2K9-7X4P",
      redeemRepo,
      scanLookup: scanRepo.lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: () => Promise.resolve("h".repeat(64)),
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("REDEEM_CODE_ALREADY_USED");
  });

  it("rejects a malformed code", async () => {
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "completed",
      status: "needs_review",
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: "not-a-code",
      redeemRepo: castRedeemRepo(new FakeRedeemRepo()),
      scanLookup: scanRepo.lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: H,
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("INVALID_REDEEM_CODE");
  });

  it("returns cached for a failed scan with status=undefined and reportUrl=null", async () => {
    const scanRepo = new FakeScanRepo();
    scanRepo.rows.push({
      id: "scan_1",
      domainKey,
      quotaDay: day,
      state: "failed",
      status: null,
      createdAt: "2026-08-03T08:00:00.000Z",
      expiresAt: "2026-08-10T08:00:00.000Z",
    });
    const r = await resolveScanRequest({
      domainKey,
      quotaDay: day,
      now,
      redeemCode: null,
      redeemRepo: castRedeemRepo(new FakeRedeemRepo()),
      scanLookup: scanRepo.lookup,
      reportGet: new FakeReportRepo().get,
      hashCode: H,
    });
    expect(r.kind).toBe("cached");
    if (r.kind === "cached") {
      expect(r.state).toBe("failed");
      expect(r.status).toBeUndefined();
      expect(r.reportUrl).toBeNull();
      expect(r.message).toBe("scan.cached.failed");
    }
  });
});
