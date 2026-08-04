import { describe, expect, it } from "vitest";
import {
  deterministicReportToken,
  deterministicTokenHash,
} from "./scan-workflow.phases";

describe("deterministicReportToken", () => {
  it("returns the same token for the same scanId", async () => {
    const a = await deterministicReportToken("scan-abc");
    const b = await deterministicReportToken("scan-abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^rpt_[0-9a-f]{64}$/);
  });

  it("returns different tokens for different scanIds", async () => {
    const a = await deterministicReportToken("scan-aaa");
    const b = await deterministicReportToken("scan-bbb");
    expect(a).not.toBe(b);
  });

  it("returns a tokenHash that is sha256(token)", async () => {
    const scanId = "scan-zzz";
    const token = await deterministicReportToken(scanId);
    const hash = await deterministicTokenHash(scanId);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(token.length - 4); // rpt_ prefix removed
  });
});
