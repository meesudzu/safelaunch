import { describe, expect, it } from "vitest";
import type { EvidenceItem, ScanCoverage } from "@safelaunch/contracts";
import { RUBRIC_VERSION, runRules, type RuleInput, type RuleOutcome } from "./rules";

const FULL_COVERAGE: ScanCoverage = {
  fetched: ["homepage", "about", "privacy", "contact", "terms"],
  failed: [],
  skipped: [],
};

const PRIVACY_FAILED_COVERAGE: ScanCoverage = {
  fetched: ["homepage", "about", "contact"],
  failed: ["privacy"],
  skipped: [],
};

const evidence = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "ev_default",
  type: "operator_identity",
  value: "Công ty Cổ phần VNG",
  sourceUrl: "https://game.test/about",
  excerpt: "Đơn vị phát hành: Công ty Cổ phần VNG, mã số doanh nghiệp 0306748546.",
  confidence: 0.9,
  ...overrides,
});

const baseInput: RuleInput = {
  scanId: "scan_1",
  jurisdiction: "VN",
  category: "online_game",
  coverage: FULL_COVERAGE,
  evidence: [
    evidence({ id: "ev_op", type: "operator_identity" }),
    evidence({
      id: "ev_contact",
      type: "contact",
      value: "hotro@volam.test",
      excerpt: "Email liên hệ: hotro@volam.test",
    }),
    evidence({
      id: "ev_priv",
      type: "privacy_notice",
      excerpt: "Chúng tôi thu thập địa chỉ email, số điện thoại và lịch sử giao dịch.",
    }),
  ],
};

describe("RUBRIC_VERSION", () => {
  it("matches the MVP release plan", () => {
    expect(RUBRIC_VERSION).toBe("vn-mvp-v2-licensing-digital-rights-strict");
  });
});

describe("citation sources", () => {
  it("uses the reviewed vbpl.vn source for contact-info", () => {
    const contact = runRules(baseInput).find((rule) => rule.ruleId === "contact-info");
    expect(contact?.citations[0]).toMatchObject({
      provisionId: "vn-pd-2025-contact-channel",
      source: "Luật An toàn thông tin mạng 2015",
    });
    expect(contact?.citations[0]?.excerpt).toBeTypeOf("string");
  });
});

describe("runRules", () => {
  it("does not infer absence from a failed privacy page", () => {
    const result = runRules({
      ...baseInput,
      coverage: PRIVACY_FAILED_COVERAGE,
      evidence: baseInput.evidence.filter((e) => e.type !== "privacy_notice"),
    });
    const privacy = result.find((rule) => rule.ruleId === "privacy-notice");
    expect(privacy?.outcome).toBe<RuleOutcome>("unknown");
    expect(privacy?.severity).toBe("review");
    expect(privacy?.rationale).toMatch(/chưa xác định|không xác định|coverage|trang/i);
    // Citations must remain empty when the verdict is unknown — we never cite
    // a provision we did not actually evaluate.
    expect(privacy?.citations).toEqual([]);
  });

  it("returns the same rationale for the same versioned input", () => {
    const first = runRules(baseInput);
    const second = runRules(baseInput);
    expect(second).toEqual(first);
  });

  it("classifies an absent privacy notice as high severity with a documented rationale", () => {
    const result = runRules({
      ...baseInput,
      coverage: FULL_COVERAGE,
      evidence: baseInput.evidence.filter((e) => e.type !== "privacy_notice"),
    });
    const privacy = result.find((rule) => rule.ruleId === "privacy-notice");
    expect(privacy?.outcome).toBe<RuleOutcome>("absent");
    expect(privacy?.severity).toBe("high");
    expect(privacy?.rationale).toContain("privacy");
    expect(privacy?.rationale.length).toBeGreaterThan(20);
    expect(privacy?.evidenceIds).toEqual([]);
    expect(privacy?.citations.length).toBeGreaterThan(0);
  });

  it("classifies a present privacy notice as pass severity and records its evidence", () => {
    const result = runRules(baseInput);
    const privacy = result.find((rule) => rule.ruleId === "privacy-notice");
    expect(privacy?.outcome).toBe<RuleOutcome>("present");
    expect(privacy?.severity).toBe("pass");
    expect(privacy?.evidenceIds).toContain("ev_priv");
    expect(privacy?.rationale).toContain("privacy");
  });

  it("classifies operator identity absence as high severity", () => {
    const result = runRules({
      ...baseInput,
      evidence: baseInput.evidence.filter((e) => e.type !== "operator_identity"),
    });
    const operator = result.find((rule) => rule.ruleId === "operator-identity");
    expect(operator?.outcome).toBe<RuleOutcome>("absent");
    expect(operator?.severity).toBe("high");
  });

  it("returns 'unknown' for contact when the contact page failed but no contact evidence is present", () => {
    const result = runRules({
      ...baseInput,
      coverage: {
        fetched: ["homepage", "about", "privacy"],
        failed: ["contact"],
        skipped: [],
      },
      evidence: baseInput.evidence.filter((e) => e.type !== "contact"),
    });
    const contact = result.find((rule) => rule.ruleId === "contact-info");
    expect(contact?.outcome).toBe<RuleOutcome>("unknown");
    expect(contact?.severity).toBe("review");
  });

  it("returns the same set of rule IDs regardless of evidence", () => {
    const first = runRules(baseInput);
    const second = runRules({ ...baseInput, evidence: [] });
    expect(first.map((rule) => rule.ruleId).sort()).toEqual(
      second.map((rule) => rule.ruleId).sort(),
    );
  });

  it("never produces a magic number — every rule carries an explicit rationale", () => {
    const result = runRules(baseInput);
    for (const rule of result) {
      expect(rule.rationale.length).toBeGreaterThan(15);
      expect(rule.severity).toMatch(/^(pass|review|high)$/);
    }
  });

  it("embeds the rubric version in every rule result", () => {
    const result = runRules(baseInput);
    for (const rule of result) {
      expect(rule.rubricVersion).toBe(RUBRIC_VERSION);
    }
  });

  it("emits rules only for the categories that match the scan", () => {
    const result = runRules({ ...baseInput, category: "online_game" });
    const ruleIds = new Set(result.map((rule) => rule.ruleId));
    expect(ruleIds.has("privacy-notice")).toBe(true);
    // Categories we have not implemented for must not produce extra findings.
    expect(ruleIds.has("license-claim-game")).toBe(true);
  });

  it("never logs the website URL or excerpt in any rationale", () => {
    const result = runRules(baseInput);
    for (const rule of result) {
      expect(rule.rationale).not.toContain("https://game.test");
      expect(rule.rationale).not.toContain("hotro@volam.test");
    }
  });
});
