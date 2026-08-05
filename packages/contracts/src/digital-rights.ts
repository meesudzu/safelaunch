import { z } from "zod";
import { Citation } from "./legal";

export const ServiceSignalKind = z.enum([
  "login",
  "ugc",
  "public_profile",
  "content_feed",
  "follow_or_friend",
  "comment",
  "share",
  "editorial_publishing",
]);

export const ServiceSignal = z.object({
  id: z.string().min(1),
  kind: ServiceSignalKind,
  observed: z.boolean(),
  confidence: z.number().min(0).max(1),
  sourceUrl: z.string().url(),
  excerpt: z.string().min(1),
  evidenceId: z.string().min(1),
});

export const LicenseCheckStatus = z.enum([
  "not_required",
  "required_verified",
  "required_declared",
  "required_not_found",
  "required_mismatch",
  "required_expired",
  "required_unavailable",
]);

export const LicenseCheck = z.object({
  id: z.string().min(1),
  licenseType: z.string().min(1),
  status: LicenseCheckStatus,
  severity: z.enum(["high", "review", "pass"]),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)),
  citations: z.array(Citation).min(1),
  recommendedAction: z.string().min(1),
  rubricVersion: z.string().min(1).optional(),
  registrySourceUrl: z.string().url().nullable().optional(),
  retrievedAt: z.string().datetime().nullable().optional(),
});

export const DigitalAssetKind = z.enum(["image", "audio", "video", "font"]);
export const AssetStatus = z.enum(["fetched", "inaccessible", "blocked"]);
export const AssetLicenseEvidence = z.enum([
  "explicit_license",
  "provider_license",
  "open_license_marker",
  "copyright_notice_only",
  "no_license_evidence",
  "inaccessible",
  "conflicting",
]);

export const DigitalAsset = z.object({
  id: z.string().min(1),
  kind: DigitalAssetKind,
  url: z.string().url(),
  host: z.string().min(1),
  sourceUrl: z.string().url(),
  contentType: z.string().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  status: AssetStatus,
  licenseEvidence: AssetLicenseEvidence,
  licenseExcerpt: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const AssetRightsSummary = z.object({
  total: z.number().int().nonnegative(),
  byKind: z.record(z.string(), z.number().int().nonnegative()),
  flagged: z.number().int().nonnegative(),
});

export type ServiceSignal = z.infer<typeof ServiceSignal>;
export type ServiceSignalKind = z.infer<typeof ServiceSignalKind>;
export type LicenseCheck = z.infer<typeof LicenseCheck>;
export type LicenseCheckStatus = z.infer<typeof LicenseCheckStatus>;
export type DigitalAsset = z.infer<typeof DigitalAsset>;
export type DigitalAssetKind = z.infer<typeof DigitalAssetKind>;
export type AssetLicenseEvidence = z.infer<typeof AssetLicenseEvidence>;
export type AssetRightsSummary = z.infer<typeof AssetRightsSummary>;
