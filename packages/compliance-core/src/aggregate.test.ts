import { describe, expect, it } from "vitest";
import type { ReportFinding, OverallReportStatus } from "@safelaunch/contracts";
import {
  aggregateFindings,
  aggregateStatus,
  type AggregateCoverage,
} from "./aggregate";

const finding = (overrides: Partial<ReportFinding>): ReportFinding => ({
  id: "f1",
  severity: "pass",
  rationale: "OK",
  confidence: 0.9,
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
  recommendedAction: "none",
  applicability: "current",
  ...overrides,
});

const completeCoverage: AggregateCoverage = { complete: true };

describe("aggregateFindings", () => {
  it("returns 'high_risk' when any current finding is high severity", () => {
    const status = aggregateFindings(
      [
        finding({ id: "f1", severity: "pass" }),
        finding({ id: "f2", severity: "high" }),
      ],
      completeCoverage,
    );
    expect(status).toBe<OverallReportStatus>("high_risk");
  });

  it("returns 'needs_review' when any current finding is review severity", () => {
    const status = aggregateFindings(
      [finding({ id: "f1", severity: "review" })],
      completeCoverage,
    );
    expect(status).toBe<OverallReportStatus>("needs_review");
  });

  it("returns 'no_significant_risk' only when coverage is complete and no high/review findings", () => {
    const status = aggregateFindings(
      [finding({ id: "f1", severity: "pass" })],
      completeCoverage,
    );
    expect(status).toBe<OverallReportStatus>("no_significant_risk");
  });

  it("never returns 'no_significant_risk' for partial coverage, even with passing findings", () => {
    const status = aggregateFindings(
      [finding({ id: "f1", severity: "pass" })],
      { complete: false },
    );
    expect(status).toBe<OverallReportStatus>("needs_review");
  });

  it("never returns 'no_significant_risk' for an empty finding list when coverage is partial", () => {
    expect(aggregateFindings([], { complete: false })).toBe<OverallReportStatus>("needs_review");
  });

  it("ignores upcoming findings when determining the current overall status", () => {
    const status = aggregateFindings(
      [
        finding({ id: "f1", severity: "pass" }),
        finding({ id: "f2", severity: "high", applicability: "upcoming" }),
      ],
      completeCoverage,
    );
    expect(status).toBe<OverallReportStatus>("no_significant_risk");
  });

  it("ignores upcoming high-severity findings for the current overall status", () => {
    const status = aggregateFindings(
      [finding({ id: "f1", severity: "high", applicability: "upcoming" })],
      completeCoverage,
    );
    expect(status).toBe<OverallReportStatus>("no_significant_risk");
  });

  it("is deterministic: same input → same output", () => {
    const findings = [
      finding({ id: "f1", severity: "review" }),
      finding({ id: "f2", severity: "pass" }),
    ];
    expect(aggregateFindings(findings, completeCoverage)).toBe(aggregateFindings(findings, completeCoverage));
  });
});

describe("aggregateStatus (lower-level helper)", () => {
  it("returns 'high_risk' when any severity is high", () => {
    expect(aggregateStatus(["pass", "review", "high"])).toBe<OverallReportStatus>("high_risk");
  });

  it("returns 'needs_review' when there is review but no high", () => {
    expect(aggregateStatus(["pass", "review"])).toBe<OverallReportStatus>("needs_review");
  });

  it("returns 'no_significant_risk' when only pass severities", () => {
    expect(aggregateStatus(["pass", "pass"])).toBe<OverallReportStatus>("no_significant_risk");
  });

  it("returns 'no_significant_risk' for an empty list", () => {
    expect(aggregateStatus([])).toBe<OverallReportStatus>("no_significant_risk");
  });
});
