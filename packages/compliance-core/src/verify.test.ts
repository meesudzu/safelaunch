import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@safelaunch/contracts";
import {
  CitationVerificationError,
  SchemaViolationError,
  type EvaluationDraft,
  type RetrievalMeta,
  type VerifyContext,
  verifyFinding,
} from "./verify";

type RetrievalResult = RetrievalMeta;

const evidence = (overrides: Partial<EvidenceItem>): EvidenceItem => ({
  id: "ev_default",
  type: "privacy_notice",
  value: "Chính sách bảo mật",
  sourceUrl: "https://game.test/privacy",
  excerpt: "Chúng tôi thu thập địa chỉ email và số điện thoại.",
  confidence: 0.9,
  ...overrides,
});

const fullText = (provisionId: string): string =>
  `Điều 1. Quy định về ${provisionId}: chủ thể dữ liệu phải được thông báo trước khi xử lý.`;

const baseContext: VerifyContext = {
  jurisdiction: "VN",
  category: "online_game",
  rubricVersion: "vn-mvp-v1",
  highRiskConfidenceThreshold: 0.9,
  evidence: [
    evidence({ id: "ev_priv", type: "privacy_notice", excerpt: "Chúng tôi thu thập..." }),
  ],
  retrieval: [
    {
      provisionId: "prov-1",
      documentId: "doc-1",
      source: "https://vbpl.vn/abc",
      title: "Sample",
      effectiveFrom: "2025-01-01T00:00:00.000Z",
      effectiveTo: "2030-01-01T00:00:00.000Z",
      score: 0.9,
    },
  ],
  retrievalText: new Map<string, string>([["prov-1", fullText("prov-1")]]),
};

describe("verifyFinding", () => {
  it("rejects an invented legal quote that is not in any retrieval text", () => {
    const invented: EvaluationDraft = {
      severity: "high",
      rationale: "Phát hiện vi phạm nghiêm trọng.",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-1"],
      legalQuotes: ["Điều này không tồn tại trong bất kỳ văn bản nào được phê duyệt."],
      confidence: 0.95,
      recommendedAction: "Gỡ bỏ nội dung và tái xuất bản.",
    };
    expect(() => verifyFinding(invented, baseContext)).toThrow(CitationVerificationError);
  });

  it("downgrades unsupported high risk to expert review when confidence is below threshold", () => {
    const weakHighRisk: EvaluationDraft = {
      severity: "high",
      rationale: "Có thể có vấn đề.",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-1"],
      legalQuotes: [fullText("prov-1")],
      confidence: 0.6,
      recommendedAction: "Kiểm tra lại.",
    };
    const result = verifyFinding(weakHighRisk, baseContext);
    expect(result.severity).toBe("review");
    expect(result.applicability).toBe("current");
  });

  it("accepts a valid draft and returns a VerifiedFinding with provenance", () => {
    const valid: EvaluationDraft = {
      severity: "high",
      rationale: "Phát hiện thiếu chính sách bảo mật.",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-1"],
      legalQuotes: [fullText("prov-1")],
      confidence: 0.95,
      recommendedAction: "Bổ sung chính sách bảo mật trước khi ra mắt.",
    };
    const result = verifyFinding(valid, baseContext);
    expect(result.severity).toBe("high");
    expect(result.citations[0]?.provisionId).toBe("prov-1");
    expect(result.citations[0]?.url).toBe("https://vbpl.vn/abc");
    expect(result.citations[0]?.excerpt).toBe(fullText("prov-1"));
    expect(result.evidenceIds).toEqual(["ev_priv"]);
    expect(result.applicability).toBe("current");
    expect(result.rubricVersion).toBe("vn-mvp-v1");
  });

  it("rejects an evidenceId that is not in the scan evidence", () => {
    const draft: EvaluationDraft = {
      severity: "high",
      rationale: "...",
      evidenceIds: ["ev_missing"],
      provisionIds: ["prov-1"],
      legalQuotes: [fullText("prov-1")],
      confidence: 0.95,
      recommendedAction: "...",
    };
    expect(() => verifyFinding(draft, baseContext)).toThrow(SchemaViolationError);
  });

  it("rejects a provisionId that is not in the retrieval set", () => {
    const draft: EvaluationDraft = {
      severity: "high",
      rationale: "...",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-rogue"],
      legalQuotes: [fullText("prov-1")],
      confidence: 0.95,
      recommendedAction: "...",
    };
    expect(() => verifyFinding(draft, baseContext)).toThrow(CitationVerificationError);
  });

  it("embeds the rubric version in every verified finding", () => {
    const valid: EvaluationDraft = {
      severity: "pass",
      rationale: "OK",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-1"],
      legalQuotes: [fullText("prov-1")],
      confidence: 0.95,
      recommendedAction: "none",
    };
    const result = verifyFinding(valid, baseContext);
    expect(result.rubricVersion).toBe("vn-mvp-v1");
  });

  it("rejects when confidence is outside the 0..1 range", () => {
    const invalid: EvaluationDraft = {
      severity: "high",
      rationale: "...",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-1"],
      legalQuotes: [fullText("prov-1")],
      confidence: 1.5,
      recommendedAction: "...",
    };
    expect(() => verifyFinding(invalid, baseContext)).toThrow(SchemaViolationError);
  });

  it("returns 'upcoming' applicability for future-dated provisions", () => {
    const upcomingRetrieval: RetrievalResult = {
      provisionId: "prov-future",
      documentId: "doc-future",
      source: "https://vbpl.vn/future",
      title: "Upcoming",
      effectiveFrom: "2030-01-01T00:00:00.000Z",
      effectiveTo: null,
      score: 0.9,
    };
    const ctx: VerifyContext = {
      ...baseContext,
      retrieval: [upcomingRetrieval],
      retrievalText: new Map<string, string>([
        ["prov-future", "Quy định có hiệu lực từ 2030: phải công khai thông tin."],
      ]),
    };
    const draft: EvaluationDraft = {
      severity: "review",
      rationale: "Sắp tới có yêu cầu mới.",
      evidenceIds: ["ev_priv"],
      provisionIds: ["prov-future"],
      legalQuotes: ["Quy định có hiệu lực từ 2030: phải công khai thông tin."],
      confidence: 0.95,
      recommendedAction: "Theo dõi ngày hiệu lực.",
    };
    const result = verifyFinding(draft, ctx, "2026-01-01T00:00:00.000Z");
    expect(result.applicability).toBe("upcoming");
  });
});
