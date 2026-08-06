/**
 * apps/workers/src/services/font-grouping.ts
 *
 * Pure functions that group `DigitalAsset` font entries into a
 * `FontInventory` (one row per family, plus a variants list).
 *
 * Grouping key:
 *   1. `fontInfo.familyName` (post parse), trimmed/lowercased.
 *   2. If the asset has no `fontInfo`, fall back to CSS `@font-face`
 *      mapping extracted from the page HTML.
 *   3. If still unknown, group under `font::unknown`.
 *
 * License status merging: when a family contains variants with
 * different `fontLicense.status`, the group becomes `conflicting` and
 * surfaces a `family_status_mismatch` reason code. The group's
 * `confidence` becomes the minimum of the variant confidences.
 */
import type {
  AssetLicenseEvidence,
  DigitalAsset,
  FontFamilyGroup,
  FontFamilyVariant,
  FontInfo,
  FontInventory,
  FontLicenseAssessment,
  FontLicenseStatus,
} from "@safelaunch/contracts";

/** Parse `<style>` blocks out of the page HTML and merge with the
 * raw page CSS string. The shared `collectAssetReferences` already
 * strips query strings from URL values, so we don't need to repeat
 * that work here.
 */
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/giu;
const FONT_FACE_RE = /@font-face\s*\{([\s\S]*?)\}/giu;
const FONT_FAMILY_RE = /font-family\s*:\s*["']?([^;"'}\s]+)["']?/iu;
const FONT_FACE_SRC_RE = /url\(\s*["']?([^"')\s]+)["']?\s*\)/giu;

const splitStyleBlocks = (html: string): string[] => {
  const out: string[] = [];
  for (const m of html.matchAll(STYLE_BLOCK_RE)) out.push(m[1] ?? "");
  return out;
};

const parseFontFaceRule = (body: string): { family: string | null; urls: string[] } => {
  const family = body.match(FONT_FAMILY_RE)?.[1] ?? null;
  const urls: string[] = [];
  for (const m of body.matchAll(FONT_FACE_SRC_RE)) {
    if (m[1]) urls.push(m[1]);
  }
  return { family, urls };
};

export const extractFontFamilyFromCss = (css: string, html: string): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  const cssText = [css, ...splitStyleBlocks(html)].join("\n");
  for (const m of cssText.matchAll(FONT_FACE_RE)) {
    const { family, urls } = parseFontFaceRule(m[1] ?? "");
    if (family === null || urls.length === 0) continue;
    const key = family.trim();
    const list = map.get(key) ?? [];
    for (const u of urls) {
      if (!list.includes(u)) list.push(u);
    }
    map.set(key, list);
  }
  return map;
};

// ---- Grouping -----------------------------------------------------------

const normalizeFamily = (raw: string | null | undefined): string => {
  if (typeof raw !== "string") return "";
  return raw.trim();
};

const isFlaggedEvidence = (e: AssetLicenseEvidence): boolean =>
  e === "no_license_evidence" ||
  e === "copyright_notice_only" ||
  e === "inaccessible" ||
  e === "conflicting";

const variantsSort = (a: FontFamilyVariant, b: FontFamilyVariant): number => {
  const aName = a.postscriptName ?? a.url;
  const bName = b.postscriptName ?? b.url;
  if (aName < bName) return -1;
  if (aName > bName) return 1;
  return 0;
};

const groupId = (familyKey: string): string => `font::${familyKey}`;

const mergeStatus = (
  variants: ReadonlyArray<{ status?: FontLicenseStatus | null | undefined }>,
): { status: FontLicenseStatus; mismatch: boolean } => {
  const present = variants
    .map((v) => v.status)
    .filter((s): s is FontLicenseStatus => typeof s === "string");
  if (present.length === 0) return { status: "unknown", mismatch: false };
  const distinct = new Set(present);
  if (distinct.size === 1) return { status: present[0]!, mismatch: false };
  return { status: "conflicting", mismatch: true };
};

const findCssFamilyForAsset = (
  asset: DigitalAsset,
  cssMap: Map<string, string[]>,
): string | null => {
  // Try to match the asset URL to any @font-face source declared in CSS.
  // The CSS urls may be absolute or relative; we do a basic suffix match.
  const path = (() => {
    try {
      return new URL(asset.url).pathname;
    } catch {
      return asset.url;
    }
  })();
  for (const [family, urls] of cssMap) {
    for (const u of urls) {
      try {
        if (new URL(u, asset.url).pathname === path) return family;
      } catch {
        if (u.endsWith(path) || path.endsWith(u)) return family;
      }
    }
  }
  return null;
};

const pickRepresentativeFontInfo = (
  variants: ReadonlyArray<{ fontInfo: FontInfo | null }>,
): FontInfo | null => {
  for (const v of variants) {
    if (v.fontInfo !== null) return v.fontInfo;
  }
  return null;
};

const pickRepresentativeLicense = (
  variants: ReadonlyArray<{ fontLicense?: FontLicenseAssessment | null | undefined }>,
): FontLicenseAssessment | null => {
  for (const v of variants) {
    if (v.fontLicense) return v.fontLicense;
  }
  return null;
};

const averageConfidence = (variants: ReadonlyArray<{ confidence: number }>): number => {
  if (variants.length === 0) return 0;
  let total = 0;
  for (const v of variants) total += v.confidence;
  return total / variants.length;
};

const minConfidence = (variants: ReadonlyArray<{ confidence: number }>): number => {
  let min = 1;
  for (const v of variants) {
    if (v.confidence < min) min = v.confidence;
  }
  return min;
};

export const groupAssetsIntoFamilies = (
  assets: readonly DigitalAsset[],
  contextHtml: string,
  contextCss: string = "",
): FontInventory => {
  const cssMap = extractFontFamilyFromCss(contextCss, contextHtml);
  // Map: normalizedFamily → list of source assets. We keep the original
  // asset and re-derive the variant shape below.
  const groups = new Map<
    string,
    {
      displayFamily: string;
      hosts: Map<string, number>;
      items: DigitalAsset[];
    }
  >();

  for (const asset of assets) {
    if (asset.kind !== "font") continue;
    const fromInfo = normalizeFamily(asset.fontInfo?.familyName);
    const fromCss = fromInfo === "" ? findCssFamilyForAsset(asset, cssMap) : null;
    const familyKey = (fromInfo || fromCss || "").toLowerCase();
    const displayFamily = fromInfo || fromCss || "Unknown";
    if (familyKey === "") {
      // Bucket all unidentifiable assets under one synthetic group.
      const key = "unknown";
      const g = groups.get(key) ?? {
        displayFamily: "Unknown",
        hosts: new Map<string, number>(),
        items: [],
      };
      g.items.push(asset);
      g.hosts.set(asset.host, (g.hosts.get(asset.host) ?? 0) + 1);
      groups.set(key, g);
      continue;
    }
    const key = groupId(familyKey);
    const g = groups.get(key) ?? {
      displayFamily,
      hosts: new Map<string, number>(),
      items: [],
    };
    g.items.push(asset);
    g.hosts.set(asset.host, (g.hosts.get(asset.host) ?? 0) + 1);
    // Prefer the most-original family casing (first occurrence).
    if (g.displayFamily === "Unknown" && displayFamily !== "Unknown") {
      g.displayFamily = displayFamily;
    }
    groups.set(key, g);
  }

  const out: FontFamilyGroup[] = [];
  for (const [key, g] of groups) {
    const variants: FontFamilyVariant[] = g.items.map((asset) => {
      const variant: FontFamilyVariant = {
        assetId: asset.id,
        url: asset.url,
        format: asset.contentType,
        postscriptName: asset.fontInfo?.postscriptName ?? null,
        subfamilyName: asset.fontInfo?.subfamilyName ?? null,
        version: asset.fontInfo?.version ?? null,
        fileSha256: asset.sha256,
        status: asset.status,
        licenseEvidence: asset.licenseEvidence,
      };
      return variant;
    });
    variants.sort(variantsSort);

    const statusInputs: Array<{ status: FontLicenseStatus | null | undefined }> = g.items.map(
      (a) => ({ status: a.fontLicense?.status }),
    );
    const { status, mismatch } = mergeStatus(statusInputs);
    const flagged = g.items.some((a) => isFlaggedEvidence(a.licenseEvidence)) || mismatch;
    const representativeFontInfo = pickRepresentativeFontInfo(
      g.items.map((a) => ({ fontInfo: a.fontInfo ?? null })),
    );
    const licenseInputs: Array<{ fontLicense: FontLicenseAssessment | null | undefined }> =
      g.items.map((a) => ({ fontLicense: a.fontLicense }));
    let representativeLicense = pickRepresentativeLicense(licenseInputs);
    if (mismatch && representativeLicense) {
      representativeLicense = {
        ...representativeLicense,
        status: "conflicting",
        reasonCodes: Array.from(
          new Set([...representativeLicense.reasonCodes, "family_status_mismatch"]),
        ),
        confidence: minConfidence(
          g.items
            .filter((a) => a.fontLicense)
            .map((a) => ({ confidence: a.fontLicense!.confidence })),
        ),
      };
    }
    if (representativeLicense && representativeLicense.status !== status) {
      // Shouldn't happen, but keep types happy if mergeStatus gave a
      // different verdict (e.g. when only one variant has a license).
      representativeLicense = { ...representativeLicense, status };
    }

    // Most common host wins.
    const sortedHosts = Array.from(g.hosts.entries()).sort((a, b) => b[1] - a[1]);
    const primaryHost = sortedHosts[0]?.[0] ?? g.items[0]!.host;

    const group: FontFamilyGroup = {
      id: key,
      family: g.displayFamily,
      kind: "font",
      host: primaryHost,
      hosts: Array.from(g.hosts.keys()).sort(),
      variants,
      fontInfo: representativeFontInfo,
      fontLicense: representativeLicense,
      confidence:
        representativeLicense?.confidence ??
        averageConfidence(g.items.map((a) => ({ confidence: a.confidence }))),
      flagged,
      citationCount: representativeLicense ? representativeLicense.evidenceSources.length : 0,
    };
    out.push(group);
  }

  out.sort((a, b) => a.family.toLowerCase().localeCompare(b.family.toLowerCase()));

  const files = out.reduce((sum, g) => sum + g.variants.length, 0);
  const flaggedCount = out.filter((g) => g.flagged).length;
  return {
    groups: out,
    totals: { families: out.length, files, flagged: flaggedCount },
  };
};
