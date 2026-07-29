import { describe, expect, it } from "vitest";
import type { ReportFinding } from "@safelaunch/contracts";
import {
  type BilingualReport,
  type ReportPayload,
  projectMachineFields,
  translateReport,
} from "./translate";

const finding = (overrides: Partial<ReportFinding>): ReportFinding => ({
  id: "f1",
  severity: "high",
  rationale: "Có vấn đề bảo mật.",
  confidence: 0.95,
  evidenceIds: ["ev-1"],
  citations: [
    {
      provisionId: "p-1",
      source: "https://vbpl.vn/x",
      url: "https://vbpl.vn/x",
      retrievedAt: "2025-01-01T00:00:00.000Z",
      excerpt: "...",
    },
  ],
  recommendedAction: "Bổ sung chính sách bảo mật.",
  applicability: "current",
  ...overrides,
});

const reportVi: ReportPayload = {
  scanId: "scan-1",
  jurisdiction: "VN",
  category: "online_game",
  status: "high_risk",
  coverage: { fetched: ["homepage"], failed: [], skipped: [] },
  findings: [finding({ id: "f1" })],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

describe("translateReport", () => {
  it("keeps machine fields identical across locales", async () => {
    const translator = async ({ text }: { text: string }) =>
      text === "Có vấn đề bảo mật." ? "Privacy issue detected." : text;
    const result = await translateReport(reportVi, translator);
    expect(projectMachineFields(result.vi)).toEqual(projectMachineFields(result.en));
  });

  it("never mutates machine fields in translation", async () => {
    const translator = async ({ text }: { text: string }) => text.toUpperCase();
    const result = await translateReport(reportVi, translator);
    expect(result.vi.findings[0]?.severity).toBe("high");
    expect(result.vi.findings[0]?.citations[0]?.provisionId).toBe("p-1");
    expect(result.en.findings[0]?.severity).toBe("high");
    expect(result.en.findings[0]?.citations[0]?.provisionId).toBe("p-1");
    expect(result.vi.status).toBe("high_risk");
    expect(result.en.status).toBe("high_risk");
  });

  it("translates the rationale and recommendedAction of every finding", async () => {
    const translator = async ({ text, locale }: { text: string; locale: "vi" | "en" }) => {
      if (locale === "vi") return text;
      const mapping: Record<string, string> = {
        "Có vấn đề bảo mật.": "Privacy issue detected.",
        "Bổ sung chính sách bảo mật.": "Add a privacy notice.",
      };
      return mapping[text] ?? text;
    };
    const result = await translateReport(reportVi, translator);
    expect(result.vi.findings[0]?.rationale).toBe("Có vấn đề bảo mật.");
    expect(result.en.findings[0]?.rationale).toBe("Privacy issue detected.");
    expect(result.vi.findings[0]?.recommendedAction).toBe("Bổ sung chính sách bảo mật.");
    expect(result.en.findings[0]?.recommendedAction).toBe("Add a privacy notice.");
  });

  it("translates the overall status' explanation field while keeping status identical", async () => {
    const translator = async ({ text }: { text: string }) =>
      text === "Trạng thái tổng thể" ? "Overall status" : text;
    const result = await translateReport(reportVi, translator, { summaryLabel: "Trạng thái tổng thể" });
    expect(result.vi.summaryLabel).toBe("Trạng thái tổng thể");
    expect(result.en.summaryLabel).toBe("Overall status");
    expect(result.vi.status).toBe("high_risk");
    expect(result.en.status).toBe("high_risk");
  });

  it("falls back to the original text when the translator throws", async () => {
    const translator = async () => {
      throw new Error("upstream failed");
    };
    const result = await translateReport(reportVi, translator);
    expect(result.vi.findings[0]?.rationale).toBe("Có vấn đề bảo mật.");
    expect(result.en.findings[0]?.rationale).toBe("Có vấn đề bảo mật.");
  });

  it("propagates the scanId, jurisdiction, category, generatedAt identically", async () => {
    const translator = async ({ text }: { text: string }) => text;
    const result = await translateReport(reportVi, translator);
    expect(result.vi.scanId).toBe("scan-1");
    expect(result.en.scanId).toBe("scan-1");
    expect(result.vi.jurisdiction).toBe("VN");
    expect(result.en.jurisdiction).toBe("VN");
    expect(result.vi.category).toBe("online_game");
    expect(result.en.category).toBe("online_game");
    expect(result.vi.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.en.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("projectMachineFields", () => {
  it("returns only the machine-safe subset of a report", () => {
    const bilingual: BilingualReport = {
      vi: reportVi,
      en: { ...reportVi },
      summaryLabel: "Trạng thái",
    };
    const projection = projectMachineFields(bilingual.en);
    expect(projection.scanId).toBe("scan-1");
    expect(projection.jurisdiction).toBe("VN");
    expect(projection.category).toBe("online_game");
    expect(projection.status).toBe("high_risk");
    expect(projection.coverage).toEqual(reportVi.coverage);
    expect(projection.findings).toEqual(reportVi.findings);
    expect(projection.generatedAt).toBe(reportVi.generatedAt);
  });
});
