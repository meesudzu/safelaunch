import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type EvalCase,
  type EvalDraft,
  type EvalProvision,
  type SystemUnderTest,
  evaluateAll,
  evaluateReleaseGates,
  loadCases,
  RELEASE_GATES,
} from "./eval-runner";

const provision = (id: string, text: string): EvalProvision => ({ id, text });

const passingCase = (id: string, severity: "high" | "review" | "pass"): EvalCase => ({
  id,
  category: "online_game",
  language: "vi",
  input: { url: `https://example.com/${id}`, evidence: "Mẫu trích dẫn từ website." },
  expected: {
    severity,
    provisionIds: ["prov-72-2013"],
    citationExcerpts: ["Điều 1. Quy định về game."],
  },
  reviewer: "reviewer-a@safelaunch.test",
  reviewDate: "2025-01-01T00:00:00.000Z",
  rationale: "Case for the suite.",
});

const fixedProvisionText: Record<string, string> = {
  "prov-72-2013": "Điều 1. Quy định về game. Cấm nội dung bạo lực.",
  "prov-pd-2023": "Điều 1. Bảo vệ dữ liệu cá nhân.",
  "prov-attt-2015": "Điều 1. An toàn thông tin mạng.",
};

const provisions: EvalProvision[] = [
  provision("prov-72-2013", fixedProvisionText["prov-72-2013"]!),
  provision("prov-pd-2023", fixedProvisionText["prov-pd-2023"]!),
  provision("prov-attt-2015", fixedProvisionText["prov-attt-2015"]!),
];

const stubSystem = (drafts: Record<string, EvalDraft>): SystemUnderTest => ({
  evaluate: ({ caseId }) =>
    Promise.resolve(
      drafts[caseId] ?? {
        severity: "pass",
        rationale: "fallback",
        evidenceIds: [],
        provisionIds: [],
        legalQuotes: [],
        confidence: 0.5,
        recommendedAction: "none",
      },
    ),
});

const goodDraft = (caseId: string, severity: "high" | "review" | "pass"): EvalDraft => ({
  severity,
  rationale: `${caseId} rationale`,
  evidenceIds: [`ev-${caseId}`],
  provisionIds: ["prov-72-2013"],
  legalQuotes: ["Điều 1. Quy định về game."],
  confidence: 0.95,
  recommendedAction: "Bổ sung chính sách bảo mật.",
});

describe("evaluateAll", () => {
  it("computes citationValidity as 1.0 when every case cites an allowed provision with a matching quote", async () => {
    const cases = [passingCase("c1", "high"), passingCase("c2", "review")];
    const system = stubSystem({ c1: goodDraft("c1", "high"), c2: goodDraft("c2", "review") });
    const metrics = await evaluateAll(cases, system, { provisions });
    expect(metrics.citationValidity).toBe(1);
  });

  it("counts unsupportedHighRisk when a high prediction cites no allowed provision", async () => {
    const cases = [passingCase("c1", "high")];
    const draft: EvalDraft = { ...goodDraft("c1", "high"), provisionIds: [] };
    const system = stubSystem({ c1: draft });
    const metrics = await evaluateAll(cases, system, { provisions });
    expect(metrics.unsupportedHighRisk).toBe(1);
  });

  it("computes highRiskPrecision from the confusion matrix", async () => {
    const cases = [
      passingCase("tp", "high"),
      passingCase("fp", "review"),
      passingCase("fn", "high"),
      passingCase("tn", "pass"),
    ];
    const system = stubSystem({
      tp: goodDraft("tp", "high"),
      fp: goodDraft("fp", "high"), // false positive
      fn: goodDraft("fn", "pass"), // false negative
      tn: goodDraft("tn", "pass"),
    });
    const metrics = await evaluateAll(cases, system, { provisions });
    expect(metrics.confusionMatrix).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    expect(metrics.highRiskPrecision).toBe(0.5);
  });

  it("computes per-category and per-language precision", async () => {
    const cases: EvalCase[] = [
      { ...passingCase("a", "high"), category: "online_game", language: "vi" },
      { ...passingCase("b", "high"), category: "online_game", language: "en" },
      { ...passingCase("c", "review"), category: "electronic_press", language: "vi" },
    ];
    const system = stubSystem({
      a: goodDraft("a", "high"),
      b: goodDraft("b", "review"), // wrong
      c: goodDraft("c", "review"),
    });
    const metrics = await evaluateAll(cases, system, { provisions });
    expect(metrics.byCategory.online_game?.correct).toBe(1);
    expect(metrics.byCategory.electronic_press?.correct).toBe(1);
    expect(metrics.byLanguage.vi?.correct).toBe(2);
    expect(metrics.byLanguage.en?.correct).toBe(0);
  });

  it("counts changed cases when the baseline differs from the current set", async () => {
    const cases = [passingCase("c1", "high")];
    const baseline: EvalCase[] = [
      {
        ...passingCase("c1", "review"),
        expected: { ...passingCase("c1", "high").expected, severity: "review" },
      },
    ];
    const system = stubSystem({ c1: goodDraft("c1", "high") });
    const metrics = await evaluateAll(cases, system, { provisions, baseline });
    expect(metrics.changedCases).toBe(1);
  });
});

describe("evaluateReleaseGates", () => {
  const passingMetrics = {
    totalCases: 100,
    confusionMatrix: { tp: 50, fp: 5, tn: 40, fn: 5 },
    citationValidity: 1,
    highRiskPrecision: 0.95,
    unsupportedHighRisk: 0,
    byCategory: {},
    byLanguage: {},
    changedCases: 0,
  };

  it("passes when every metric meets its gate", () => {
    const result = evaluateReleaseGates(passingMetrics);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when citation validity is below 1.0", () => {
    const result = evaluateReleaseGates({ ...passingMetrics, citationValidity: 0.98 });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("citationValidity"))).toBe(true);
  });

  it("fails when high-risk precision is below 0.9", () => {
    const result = evaluateReleaseGates({ ...passingMetrics, highRiskPrecision: 0.85 });
    expect(result.pass).toBe(false);
  });

  it("fails when any unsupported high-risk prediction is present", () => {
    const result = evaluateReleaseGates({ ...passingMetrics, unsupportedHighRisk: 1 });
    expect(result.pass).toBe(false);
  });

  it("exports the documented gate thresholds", () => {
    expect(RELEASE_GATES.citationValidity).toBe(1);
    expect(RELEASE_GATES.highRiskPrecision).toBe(0.9);
    expect(RELEASE_GATES.unsupportedHighRisk).toBe(0);
    expect(RELEASE_GATES.p95LatencyMs).toBe(60_000);
  });
});

describe("loadCases", () => {
  it("parses every JSON file in the cases directory", async () => {
    const cases = await loadCases(join(process.cwd(), "../../tests/evals/cases"));
    expect(cases.length).toBeGreaterThanOrEqual(60);
    const categories = new Set(cases.map((c) => c.category));
    expect(categories.has("online_game")).toBe(true);
    expect(categories.has("electronic_press")).toBe(true);
    expect(categories.has("digital_entertainment")).toBe(true);
    const highRisk = cases.filter((c) => c.expected.severity === "high").length;
    expect(highRisk).toBeGreaterThanOrEqual(30);
    const languages = new Set(cases.map((c) => c.language));
    expect(languages.has("vi")).toBe(true);
    expect(languages.has("en")).toBe(true);
  });
});
