import type { OverallReportStatus } from "@safelaunch/contracts";

export type RuleOutcome = "present" | "absent" | "unknown";

export type RuleSeverity = "high" | "review" | "pass";

export const RUBRIC_VERSION = "vn-mvp-v1";

export const severityFor = (outcome: RuleOutcome): RuleSeverity => {
  if (outcome === "absent") return "high";
  if (outcome === "unknown") return "review";
  return "pass";
};

export const aggregateStatus = (
  severities: readonly RuleSeverity[],
): OverallReportStatus => {
  if (severities.some((severity) => severity === "high")) return "high_risk";
  if (severities.some((severity) => severity === "review")) return "needs_review";
  return "no_significant_risk";
};
