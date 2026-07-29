import type { OverallReportStatus, ReportFinding } from "@safelaunch/contracts";

/**
 * Deterministic report aggregator.
 *
 * Status precedence (highest first):
 *  - any current-severity "high" → high_risk
 *  - any current-severity "review" OR partial coverage → needs_review
 *  - otherwise → no_significant_risk
 *
 * Upcoming-severity findings do NOT promote the current status to
 * high_risk — they appear separately in the report and never imply a
 * current violation.
 */
export interface AggregateCoverage {
  readonly complete: boolean;
}

export const aggregateStatus = (
  severities: readonly ("high" | "review" | "pass")[],
): OverallReportStatus => {
  if (severities.includes("high")) return "high_risk";
  if (severities.includes("review")) return "needs_review";
  return "no_significant_risk";
};

export const aggregateFindings = (
  findings: readonly ReportFinding[],
  coverage: AggregateCoverage,
): OverallReportStatus => {
  const currentSeverities: ("high" | "review" | "pass")[] = findings
    .filter((finding) => finding.applicability === "current")
    .map((finding) => finding.severity);
  const baseStatus = aggregateStatus(currentSeverities);
  if (!coverage.complete) return "needs_review";
  return baseStatus;
};
