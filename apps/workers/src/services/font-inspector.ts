/**
 * apps/workers/src/services/font-inspector.ts
 *
 * Pure functions that:
 *   1. Parse font binary metadata (TTF/OTF/WOFF/WOFF2) into a stable
 *      `FontInfo` shape. TTC/DFont fall back to the first face.
 *   2. Decide the license status (`FontLicenseStatus`) using a static
 *      versioned registry plus contextual page markers.
 *
 * Both modules are deterministic and have no I/O — they receive a
 * bounded buffer plus pre-fetched contextHtml and the SHA-256 of the
 * font bytes (already computed by the asset collector).
 */
import * as fontkit from "fontkit";
import type {
  FontInfo,
  FontLicenseAssessment,
  FontLicenseReasonCode,
  FontLicenseStatus,
  LegalCitation,
} from "@safelaunch/contracts";

// ---- Registry types ----------------------------------------------------

export interface FontRegistryCitation extends LegalCitation {
  provisionId: string;
}

export interface FontRegistryEntry {
  family: string;
  postscriptName: string;
  weight?: number;
  style?: string;
  license: string;
  licenseUrl: string;
  version: string;
  copyright: string | null;
  sourceUrl: string;
  sha256: string | null;
}

export interface FontRegistryHint {
  family: string;
  note: string;
  sourceUrl: string;
}

export interface FontRegistry {
  version: string;
  fonts: readonly FontRegistryEntry[];
  commercialNameHints: readonly FontRegistryHint[];
  citation: FontRegistryCitation;
}

// ---- Parsing -----------------------------------------------------------

/** Probe the first 4 bytes to detect format. We do not use the contentType
 * as a hard requirement because some hosts serve font bytes with a
 * generic `application/octet-stream` content type.
 */
const probeFormat = (bytes: Uint8Array, contentType: string | null): FontInfo["format"] => {
  if (bytes.byteLength < 4) return "Unknown";
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === "wOF2") return "WOFF2";
  if (tag === "wOFF") return "WOFF";
  if (tag === "OTTO") return "OTF";
  if (tag === "true" || tag === String.fromCharCode(0, 1, 0, 0)) return "TTF";
  if (tag === "ttcf") return "TTC";
  if (bytes.byteLength >= 256 && contentType !== null && /dfont|macbinary/i.test(contentType)) {
    return "DFont";
  }
  return "Unknown";
};

/** Map OpenType fsType bit field to a friendly enum. Only bits 0-3 (the
 * embedding permissions sub-field) are reliable; bit 8 (noSubsetting) and
 * bit 9 (bitmapOnly) are reported separately when set.
 */
const decodeFsType = (raw: unknown): FontInfo["fsType"] => {
  // fontkit exposes `OS/2.fsType` either as a number (raw bit field) or as
  // a decoded object (`{ noEmbedding, viewOnly, editable, noSubsetting,
  // bitmapOnly }`). Accept both shapes for forward-compat.
  if (raw === null || raw === undefined) return "unknown";
  if (typeof raw === "object") {
    const o = raw as {
      noEmbedding?: boolean;
      viewOnly?: boolean;
      editable?: boolean;
      noSubsetting?: boolean;
      bitmapOnly?: boolean;
    };
    if (o.bitmapOnly) return "bitmap_only";
    if (o.noEmbedding) return "restricted";
    if (o.viewOnly) return "preview_print";
    if (o.editable) return "editable";
    if (o.noSubsetting) return "preview_print";
    return "installable";
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "unknown";
  const noSubsetting = (raw & 0x0100) !== 0;
  const bitmapOnly = (raw & 0x0200) !== 0;
  if (bitmapOnly) return "bitmap_only";
  // The 4 sub-field bits are mutually exclusive but some legacy fonts
  // set multiple. We follow the spec: pick the most restrictive.
  if ((raw & 0x0002) !== 0) return "restricted";
  if ((raw & 0x0004) !== 0) return "preview_print";
  if ((raw & 0x0008) !== 0) return "editable";
  if (noSubsetting) return "preview_print";
  if ((raw & 0x0001) !== 0) return "unknown"; // bit 0 reserved/deprecated
  return "installable";
};

interface FontkitFont {
  type: string;
  familyName?: string | null;
  subfamilyName?: string | null;
  fullName?: string | null;
  postscriptName?: string | null;
  version?: string | null;
  copyright?: string | null;
  "OS/2"?: {
    fsType?:
      | number
      | {
          noEmbedding?: boolean;
          viewOnly?: boolean;
          editable?: boolean;
          noSubsetting?: boolean;
          bitmapOnly?: boolean;
        };
    achVendID?: string;
  };
  getName?: (key: string) => string | null;
  name?: { records?: Record<string, unknown> };
}

/** fontkit returns the first face for TTC/DFont, so we don't need to
 * iterate the collection manually. The only branch we take is to keep
 * the public `format` accurate.
 */
export const parseFontBytes = (bytes: Uint8Array, contentType: string | null): FontInfo | null => {
  if (bytes.byteLength < 4) return null;
  const format = probeFormat(bytes, contentType);
  let font: FontkitFont | null;
  try {
    font = fontkit.create(bytes as unknown as Buffer) as unknown as FontkitFont;
  } catch {
    return null;
  }
  if (!font) return null;

  // For TTC/DFont, fontkit returns a `TrueTypeCollection` object that
  // exposes `fonts` rather than a single face. Pick the first one.
  const collection = font as unknown as { fonts?: FontkitFont[] };
  if (Array.isArray(collection.fonts) && collection.fonts.length > 0) {
    font = collection.fonts[0]!;
  }

  const family =
    (typeof font.getName === "function" ? font.getName("preferredFamily") : null) ||
    (typeof font.getName === "function" ? font.getName("fontFamily") : null) ||
    (font.familyName ?? null);
  const subfamily =
    (typeof font.getName === "function" ? font.getName("preferredSubfamily") : null) ||
    (typeof font.getName === "function" ? font.getName("fontSubfamily") : null) ||
    (font.subfamilyName ?? null);
  const postscriptName = font.postscriptName ?? null;
  const fullName = font.fullName ?? null;
  const version = font.version ?? null;
  const copyright = font.copyright ?? null;
  const os2 = font["OS/2"] as { fsType?: unknown; achVendID?: string } | undefined;
  const vendorId = os2?.achVendID ? String(os2.achVendID) : null;
  const fsType = decodeFsType(os2?.fsType);

  return {
    familyName: family ? String(family) : null,
    subfamilyName: subfamily ? String(subfamily) : null,
    fullName: fullName ? String(fullName) : null,
    postscriptName: postscriptName ? String(postscriptName) : null,
    version: version ? String(version) : null,
    copyright: copyright ? String(copyright) : null,
    vendorId: vendorId ? String(vendorId) : null,
    fsType,
    format: format === "Unknown" ? "Unknown" : format,
    fileSize: bytes.byteLength,
  };
};

// ---- License assessment ------------------------------------------------

const PAGE_CC_RE = /.{0,60}(?:creative commons|creativecommons|cc by|royalty[- ]free).{0,100}/iu;
const PAGE_LICENSE_RE = /.{0,60}(?:license|licence|attribution|được phép sử dụng).{0,100}/iu;

const GOOGLE_FONTS_HOST_RE = /^(?:fonts\.gstatic\.com|fonts\.googleapis\.com)$/iu;

const isCommercialHint = (family: string, hints: readonly FontRegistryHint[]): boolean => {
  const normalized = family.toLowerCase().trim();
  return hints.some((h) => h.family.toLowerCase().trim() === normalized);
};

const OPENTYPE_FONT_FSTYPE_CITATION: LegalCitation = {
  provisionId: "opentype-os2-fstype",
  source: "OpenType OS/2 table — fsType",
  url: "https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype",
  retrievedAt: "2026-08-06T00:00:00.000Z",
  excerpt:
    "The fsType field in the OpenType OS/2 table records the embedding licensing rights granted by the font vendor. Restricted (bit 1), Preview & Print (bit 2), Editable (bit 3), No Subsetting (bit 8) and Bitmap-Only (bit 9) restrict how the font may be embedded without an additional license.",
};

const SIL_OFL_CITATION: LegalCitation = {
  provisionId: "sil-open-font-license-1.1",
  source: "SIL Open Font License 1.1",
  url: "https://openfontlicense.org/open-font-license-official-text/",
  retrievedAt: "2026-08-06T00:00:00.000Z",
  excerpt:
    "Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the conditions of the license.",
};

const IP_LAW_CITATION: LegalCitation = {
  provisionId: "vn-ip-law-2022",
  source: "Luật Sở hữu trí tuệ 2022",
  url: "https://vbpl.vn/tim-kiem?SearchIn=all&q=Lu%E1%BA%ADt%20S%E1%BB%9F%20h%E1%BB%AFu%20tr%C3%AD%20tu%E1%BB%87%202022",
  retrievedAt: "2026-08-06T00:00:00.000Z",
  excerpt:
    "Tổ chức, cá nhân sử dụng tác phẩm, bản ghi âm, hình ảnh, chương trình phát sóng phải có sự đồng ý của chủ sở hữu hoặc theo giấy phép tương ứng.",
};

// We can't reference the registry citation from this static table; the
// registry citation is appended dynamically in `assessFontLicense` when
// the registry version is consulted.
const CITATION_FOR_REASON: Record<FontLicenseReasonCode, readonly LegalCitation[]> = {
  registry_hash_match: [IP_LAW_CITATION, SIL_OFL_CITATION],
  google_provider_identity_match: [IP_LAW_CITATION, SIL_OFL_CITATION],
  fs_type_restricted_embedding: [IP_LAW_CITATION, OPENTYPE_FONT_FSTYPE_CITATION],
  fs_type_preview_print: [IP_LAW_CITATION, OPENTYPE_FONT_FSTYPE_CITATION],
  fs_type_editable: [IP_LAW_CITATION, OPENTYPE_FONT_FSTYPE_CITATION],
  fs_type_bitmap_only: [IP_LAW_CITATION, OPENTYPE_FONT_FSTYPE_CITATION],
  commercial_catalog_name_hint: [IP_LAW_CITATION],
  page_open_license_marker: [IP_LAW_CITATION],
  page_explicit_license: [IP_LAW_CITATION],
  no_license_metadata: [IP_LAW_CITATION],
  registry_hash_mismatch: [IP_LAW_CITATION],
  family_status_mismatch: [IP_LAW_CITATION],
  parse_failed: [IP_LAW_CITATION],
  size_or_count_limit: [IP_LAW_CITATION],
};

export interface AssessFontLicenseInput {
  fontInfo: FontInfo | null;
  host: string;
  contextHtml: string;
  sha256: string | null;
  registry: FontRegistry;
  /** Override the default `retrievedAt` timestamp (mostly for tests). */
  now?: Date;
}

const mergeCitations = (codes: readonly FontLicenseReasonCode[]): LegalCitation[] => {
  const out: LegalCitation[] = [];
  for (const code of codes) {
    const list = CITATION_FOR_REASON[code];
    for (const c of list) {
      if (!out.some((existing) => existing.url === c.url)) out.push(c);
    }
  }
  return out;
};

/** Find a registry entry by SHA-256 first, then by PostScript name + family
 * (used as a secondary identity check for gstatic URLs that may use
 * different subset URLs with the same identity).
 */
const findRegistryEntry = (
  registry: FontRegistry,
  args: { sha256: string | null; postscriptName: string | null; family: string | null },
): { entry: FontRegistryEntry; byHash: boolean } | null => {
  if (args.sha256) {
    const byHash = registry.fonts.find(
      (f) => typeof f.sha256 === "string" && f.sha256 === args.sha256,
    );
    if (byHash) return { entry: byHash, byHash: true };
  }
  if (args.postscriptName) {
    const byName = registry.fonts.find(
      (f) =>
        f.postscriptName === args.postscriptName &&
        (args.family === null || f.family === args.family),
    );
    if (byName) return { entry: byName, byHash: false };
  }
  return null;
};

export const assessFontLicense = (input: AssessFontLicenseInput): FontLicenseAssessment => {
  const now = input.now ?? new Date();
  const retrievedAt = now.toISOString();
  const { fontInfo, host, contextHtml, sha256, registry } = input;

  if (fontInfo === null) {
    return {
      status: "unavailable",
      reasonCodes: ["parse_failed"],
      confidence: 0,
      evidenceSources: mergeCitations(["parse_failed"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 1. SHA match in registry (strongest evidence).
  const match = findRegistryEntry(registry, {
    sha256,
    postscriptName: fontInfo.postscriptName,
    family: fontInfo.familyName,
  });
  if (match?.byHash) {
    return {
      status: "verified_open",
      reasonCodes: ["registry_hash_match"],
      confidence: 0.95,
      evidenceSources: [...mergeCitations(["registry_hash_match"]), registry.citation],
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 2. PostScript name matches registry AND host is Google Fonts
  //    → strong identity match.
  if (
    match &&
    !match.byHash &&
    GOOGLE_FONTS_HOST_RE.test(host) &&
    fontInfo.postscriptName !== null
  ) {
    return {
      status: "verified_open",
      reasonCodes: ["google_provider_identity_match"],
      confidence: 0.9,
      evidenceSources: [...mergeCitations(["google_provider_identity_match"]), registry.citation],
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 2b. PostScript name matches registry but hash differs → possible fork.
  if (match && !match.byHash) {
    return {
      status: "conflicting",
      reasonCodes: ["registry_hash_mismatch"],
      confidence: 0.7,
      evidenceSources: mergeCitations(["registry_hash_mismatch"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 3. fsType restrictions.
  if (fontInfo.fsType === "restricted") {
    return {
      status: "requires_license_proof",
      reasonCodes: ["fs_type_restricted_embedding"],
      confidence: 0.65,
      evidenceSources: mergeCitations(["fs_type_restricted_embedding"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }
  if (fontInfo.fsType === "preview_print") {
    return {
      status: "requires_license_proof",
      reasonCodes: ["fs_type_preview_print"],
      confidence: 0.6,
      evidenceSources: mergeCitations(["fs_type_preview_print"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }
  if (fontInfo.fsType === "editable") {
    return {
      status: "requires_license_proof",
      reasonCodes: ["fs_type_editable"],
      confidence: 0.55,
      evidenceSources: mergeCitations(["fs_type_editable"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }
  if (fontInfo.fsType === "bitmap_only") {
    return {
      status: "requires_license_proof",
      reasonCodes: ["fs_type_bitmap_only"],
      confidence: 0.55,
      evidenceSources: mergeCitations(["fs_type_bitmap_only"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 4. Commercial name hint (low confidence — never used alone as proof).
  if (fontInfo.familyName && isCommercialHint(fontInfo.familyName, registry.commercialNameHints)) {
    return {
      status: "requires_license_proof",
      reasonCodes: ["commercial_catalog_name_hint"],
      confidence: 0.4,
      evidenceSources: mergeCitations(["commercial_catalog_name_hint"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 5. Page marker for Creative Commons / royalty-free.
  if (PAGE_CC_RE.test(contextHtml)) {
    return {
      status: "declared_open",
      reasonCodes: ["page_open_license_marker"],
      confidence: 0.7,
      evidenceSources: mergeCitations(["page_open_license_marker"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 5b. Generic license keyword on the page.
  if (PAGE_LICENSE_RE.test(contextHtml)) {
    return {
      status: "declared_open",
      reasonCodes: ["page_explicit_license"],
      confidence: 0.55,
      evidenceSources: mergeCitations(["page_explicit_license"]),
      retrievedAt,
      registryVersion: registry.version,
    };
  }

  // 6. Fallback: no license metadata.
  return {
    status: "unknown",
    reasonCodes: ["no_license_metadata"],
    confidence: 0.4,
    evidenceSources: mergeCitations(["no_license_metadata"]),
    retrievedAt,
    registryVersion: registry.version,
  };
};

/** Build a `FontLicenseAssessment` for the "we did not even try" case —
 * e.g. when the binary was not downloaded due to size limits.
 */
export const unavailableFontLicense = (
  registry: FontRegistry,
  reason: FontLicenseReasonCode = "size_or_count_limit",
  now: Date = new Date(),
): FontLicenseAssessment => ({
  status: "unavailable",
  reasonCodes: [reason],
  confidence: 0,
  evidenceSources: mergeCitations([reason]),
  retrievedAt: now.toISOString(),
  registryVersion: registry.version,
});

// Re-exports for convenience in callers / tests.
export type { FontInfo, FontLicenseAssessment, FontLicenseStatus, FontLicenseReasonCode };
