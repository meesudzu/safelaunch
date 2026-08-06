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

/**
 * Font binary metadata extracted from the file when parsing succeeds.
 * All fields are optional because not every font embeds every record,
 * and parsing may fail entirely (e.g. truncated downloads). UI must
 * tolerate a fully-null `fontInfo` and show a generic "Font metadata
 * unavailable" hint in that case.
 */
export const FontInfo = z
  .object({
    familyName: z.string().min(1).nullable(),
    subfamilyName: z.string().min(1).nullable(),
    fullName: z.string().min(1).nullable(),
    postscriptName: z.string().min(1).nullable(),
    version: z.string().min(1).nullable(),
    copyright: z.string().nullable(),
    vendorId: z.string().nullable(),
    fsType: z.enum([
      "installable",
      "restricted",
      "preview_print",
      "editable",
      "bitmap_only",
      "unknown",
    ]),
    format: z.enum(["TTF", "OTF", "WOFF", "WOFF2", "TTC", "DFont", "Unknown"]),
    fileSize: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Why we picked the license status. Every `reasonCode` is paired with a
 * citation in `evidenceSources` (where applicable). Adding a new code
 * requires updating
 * `docs/compliance/rubrics/vn-mvp-v2-licensing-font-evidence-v1.md` so the
 * public rationale stays auditable.
 */
export const FontLicenseReasonCode = z.enum([
  "registry_hash_match",
  "google_provider_identity_match",
  "fs_type_restricted_embedding",
  "fs_type_preview_print",
  "fs_type_editable",
  "fs_type_bitmap_only",
  "commercial_catalog_name_hint",
  "page_open_license_marker",
  "page_explicit_license",
  "no_license_metadata",
  "registry_hash_mismatch",
  "family_status_mismatch",
  "parse_failed",
  "size_or_count_limit",
]);

export const FontLicenseStatus = z.enum([
  "verified_open",
  "declared_open",
  "requires_license_proof",
  "unknown",
  "conflicting",
  "unavailable",
]);

export const FontLicenseAssessment = z
  .object({
    status: FontLicenseStatus,
    reasonCodes: z.array(FontLicenseReasonCode).min(1),
    confidence: z.number().min(0).max(1),
    evidenceSources: z.array(Citation),
    retrievedAt: z.string().datetime(),
    registryVersion: z.string().min(1).nullable(),
  })
  .strict();

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
  // V1 (font evidence) — optional for backward compat with persisted reports.
  // `null` distinguishes "tried to parse and failed" from
  // "this field is absent on a legacy report".
  fontInfo: FontInfo.nullable().optional(),
  fontLicense: FontLicenseAssessment.nullable().optional(),
});

export const AssetRightsSummary = z.object({
  total: z.number().int().nonnegative(),
  byKind: z.record(z.string(), z.number().int().nonnegative()),
  flagged: z.number().int().nonnegative(),
});

/**
 * One row in the font inventory: a single font family, regardless of how
 * many file variants the page references. Variants are sorted by
 * PostScript name then URL for stable rendering.
 */
export const FontFamilyVariant = z
  .object({
    assetId: z.string().min(1),
    url: z.string().url(),
    format: z.string().nullable(),
    postscriptName: z.string().min(1).nullable(),
    subfamilyName: z.string().min(1).nullable(),
    version: z.string().min(1).nullable(),
    fileSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    status: AssetStatus,
    licenseEvidence: AssetLicenseEvidence,
  })
  .strict();

export const FontFamilyGroup = z
  .object({
    id: z.string().min(1),
    family: z.string().min(1),
    kind: z.literal("font"),
    host: z.string().min(1),
    hosts: z.array(z.string().min(1)).min(1),
    variants: z.array(FontFamilyVariant).min(1),
    fontInfo: FontInfo.nullable(),
    fontLicense: FontLicenseAssessment.nullable(),
    confidence: z.number().min(0).max(1),
    flagged: z.boolean(),
    citationCount: z.number().int().nonnegative(),
  })
  .strict();

export const FontInventory = z
  .object({
    groups: z.array(FontFamilyGroup),
    totals: z.object({
      families: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
      flagged: z.number().int().nonnegative(),
    }),
  })
  .strict();

export type ServiceSignal = z.infer<typeof ServiceSignal>;
export type ServiceSignalKind = z.infer<typeof ServiceSignalKind>;
export type LicenseCheck = z.infer<typeof LicenseCheck>;
export type LicenseCheckStatus = z.infer<typeof LicenseCheckStatus>;
export type DigitalAsset = z.infer<typeof DigitalAsset>;
export type DigitalAssetKind = z.infer<typeof DigitalAssetKind>;
export type AssetLicenseEvidence = z.infer<typeof AssetLicenseEvidence>;
export type AssetRightsSummary = z.infer<typeof AssetRightsSummary>;
export type FontInfo = z.infer<typeof FontInfo>;
export type FontLicenseReasonCode = z.infer<typeof FontLicenseReasonCode>;
export type FontLicenseStatus = z.infer<typeof FontLicenseStatus>;
export type FontLicenseAssessment = z.infer<typeof FontLicenseAssessment>;
export type FontFamilyVariant = z.infer<typeof FontFamilyVariant>;
export type FontFamilyGroup = z.infer<typeof FontFamilyGroup>;
export type FontInventory = z.infer<typeof FontInventory>;

/**
 * Reason codes that should raise a `review`-severity finding. Anything
 * else (e.g. `no_license_metadata`, `parse_failed`) is informational
 * only — the family is surfaced in the inventory but does not push
 * the report toward `needs_review`.
 */
export const FONT_LICENSE_REVIEW_REASONS: ReadonlySet<FontLicenseReasonCode> =
  new Set<FontLicenseReasonCode>([
    "fs_type_restricted_embedding",
    "fs_type_preview_print",
    "fs_type_editable",
    "fs_type_bitmap_only",
    "commercial_catalog_name_hint",
    "registry_hash_mismatch",
    "family_status_mismatch",
  ]);
