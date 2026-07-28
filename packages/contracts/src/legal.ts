import { z } from "zod";

export const Citation = z.object({
  provisionId: z.string().min(1),
  source: z.string().min(1),
  url: z.string().url(),
  retrievedAt: z.string().datetime(),
  excerpt: z.string().min(1),
});
export const Evidence = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
  sourceUrl: z.string().url(),
  excerpt: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type LegalCitation = z.infer<typeof Citation>;
export type EvidenceItem = z.infer<typeof Evidence>;
