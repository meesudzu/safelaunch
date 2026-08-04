import { z } from "zod";
import { ScanState, ScanCoverage } from "./scan";

export const ScanCachedResponse = z.object({
  scanId: z.string(),
  state: ScanState,
  status: z.enum(["high_risk", "needs_review", "no_significant_risk"]).optional(),
  coverage: ScanCoverage,
  createdAt: z.string(),
  expiresAt: z.string(),
  reportUrl: z.string().nullable(),
  cached: z.literal(true),
  quotaDay: z.string(),
  domainKey: z.string(),
  message: z.string(),
});
export type ScanCachedResponse = z.infer<typeof ScanCachedResponse>;
