import { z } from "zod";
import { Citation } from "./legal";

export const Finding = z.object({
  id: z.string().min(1),
  severity: z.enum(["high", "review", "pass"]),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  citations: z.array(Citation).min(1),
  recommendedAction: z.string().min(1),
  applicability: z.enum(["current", "upcoming"]),
});
export const ReportStatus = z.enum(["high_risk", "needs_review", "no_significant_risk"]);

export type ReportFinding = z.infer<typeof Finding>;
export type OverallReportStatus = z.infer<typeof ReportStatus>;
