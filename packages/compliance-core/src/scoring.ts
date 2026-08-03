export type RuleOutcome = "present" | "absent" | "unknown";

export type RuleSeverity = "high" | "review" | "pass";

export const RUBRIC_VERSION = "vn-mvp-v1";

export const severityFor = (outcome: RuleOutcome): RuleSeverity => {
  if (outcome === "absent") return "high";
  if (outcome === "unknown") return "review";
  return "pass";
};
