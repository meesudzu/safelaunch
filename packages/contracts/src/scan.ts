import { z } from "zod";

export const JurisdictionCode = z.enum(["VN"]);
export const AppCategory = z.enum(["online_game", "electronic_press", "digital_entertainment"]);
export const CreateScanInput = z.object({
  url: z.string().url(),
  jurisdiction: JurisdictionCode,
  category: AppCategory,
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

export type CreateScan = z.infer<typeof CreateScanInput>;
export type ScanStatus = z.infer<typeof ScanState>;
