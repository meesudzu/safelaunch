import { z } from "zod";

export const JurisdictionCode = z.enum(["VN"]);
export const AppCategory = z.enum(["online_game", "electronic_press", "digital_entertainment"]);

// Safe alphabet excludes ambiguous chars O, I, L, 0, 1.
export const RedeemCodeShape = z.string().regex(
  /^SL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,
);

export const CreateScanInput = z.object({
  url: z.string().url(),
  jurisdiction: JurisdictionCode,
  category: AppCategory,
  redeemCode: RedeemCodeShape.optional(),
});
export const ScanState = z.enum([
  "queued",
  "fetching",
  "extracting",
  "retrieving",
  "evaluating",
  "reporting",
  "completed",
  "partial",
  "failed",
]);

export const ScanCoverage = z.object({
  fetched: z.array(z.string()),
  failed: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type ScanCoverage = z.infer<typeof ScanCoverage>;

export type CreateScan = z.infer<typeof CreateScanInput>;
export type ScanStatus = z.infer<typeof ScanState>;
