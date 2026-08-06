import type {
  AssetLicenseEvidence,
  AssetRightsSummary,
  DigitalAsset,
  DigitalAssetKind,
  LegalCitation,
} from "@safelaunch/contracts";

export type AssetReference = {
  kind: DigitalAssetKind;
  url: string;
  sourceUrl: string;
};

export type AssetFetcherResult = {
  status: number;
  bytes: Uint8Array;
  contentType: string | null;
  finalUrl: string;
};

export interface AssetFetcher {
  fetch(url: string): Promise<AssetFetcherResult>;
}

export type AssetFinding = {
  id: string;
  domain: "digital-rights";
  severity: "high" | "review" | "pass";
  rationale: string;
  confidence: number;
  evidenceIds: string[];
  citations: LegalCitation[];
  recommendedAction: string;
  applicability: "current";
  assetId: string;
};

export type DigitalAssetCollection = {
  assets: DigitalAsset[];
  findings: AssetFinding[];
  summary: AssetRightsSummary;
};

export const MAX_ASSETS = 50;
export const MAX_ASSET_BYTES = 2_000_000;

const COPYRIGHT_CITATION: LegalCitation = {
  provisionId: "vn-ip-law-2022",
  source: "Luật Sở hữu trí tuệ 2022",
  url: "https://vbpl.vn/tim-kiem?SearchIn=all&q=Lu%E1%BA%ADt%20S%E1%BB%9F%20h%E1%BB%AFu%20tr%C3%AD%20tu%E1%BB%87%202022",
  retrievedAt: "2026-08-05T00:00:00.000Z",
  excerpt:
    "Tổ chức, cá nhân sử dụng tác phẩm, bản ghi âm, hình ảnh, chương trình phát sóng phải có sự đồng ý của chủ sở hữu hoặc theo giấy phép tương ứng.",
};

const absoluteUrl = (baseUrl: string, rawUrl: string): URL | null => {
  try {
    const url = new URL(rawUrl.trim(), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
};

export const redactAssetUrl = (url: URL): string => {
  const redacted = new URL(url.toString());
  redacted.search = "";
  redacted.hash = "";
  return redacted.toString();
};

const isPrivateHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && (second ?? 0) === 254) ||
    (first === 172 && (second ?? 0) >= 16 && (second ?? 0) <= 31) ||
    (first === 192 && (second ?? 0) === 168)
  );
};

export const isAllowedAssetUrl = (url: URL): boolean => !isPrivateHostname(url.hostname);

const attributeValues = (html: string, tag: string, attribute: string): string[] => {
  const values: string[] = [];
  const tagPattern = new RegExp(`<${tag}\\b[^>]*>`, "giu");
  for (const tagMatch of html.matchAll(tagPattern)) {
    const attributePattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "iu");
    const value = tagMatch[0].match(attributePattern)?.[1];
    if (value) values.push(value);
  }
  return values;
};

const stylesheetValues = (html: string): string[] => {
  const values: string[] = [];
  const pattern =
    /<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/giu;
  const reversePattern =
    /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/giu;
  for (const match of html.matchAll(pattern)) if (match[1]) values.push(match[1]);
  for (const match of html.matchAll(reversePattern)) if (match[1]) values.push(match[1]);
  return values;
};

const cssUrls = (css: string): string[] => {
  const values: string[] = [];
  const pattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/giu;
  for (const match of css.matchAll(pattern)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
};

const addReferences = (
  refs: AssetReference[],
  baseUrl: string,
  sourceUrl: string,
  kind: DigitalAssetKind,
  values: readonly string[],
): void => {
  const source = absoluteUrl(baseUrl, sourceUrl);
  const safeSourceUrl = source ? redactAssetUrl(source) : sourceUrl;
  for (const rawUrl of values) {
    if (!rawUrl || rawUrl.startsWith("data:")) continue;
    const resolved = absoluteUrl(baseUrl, rawUrl);
    if (!resolved) continue;
    refs.push({ kind, url: redactAssetUrl(resolved), sourceUrl: safeSourceUrl });
  }
};

/**
 * Collect asset references from a single page of HTML, plus inline stylesheet
 * URLs. This is a pure deterministic phase: it does not perform any network
 * fetch and runs in O(html-length).
 */
export const collectAssetReferences = (sourceUrl: string, html: string): AssetReference[] => {
  const refs: AssetReference[] = [];
  addReferences(refs, sourceUrl, sourceUrl, "font", [
    ...attributeValues(html, "link", "href").filter((value) =>
      /(?:font|\.woff2?|\.ttf|\.otf|\.eot)(?:[?#]|$)/iu.test(value),
    ),
    ...cssUrls(
      [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)]
        .map((match) => match[1] ?? "")
        .join("\n"),
    ).filter((value) => /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/iu.test(value)),
    ...cssUrls(html).filter((value) => /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/iu.test(value)),
  ]);
  const seen = new Set<string>();
  return refs
    .filter((ref) => {
      const key = `${ref.kind}:${ref.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ASSETS);
};

const providerFor = (host: string): boolean =>
  /(?:fonts\.googleapis\.com|fonts\.gstatic\.com|unsplash\.com|pexels\.com|pixabay\.com)$/iu.test(
    host,
  );

const licenseEvidenceFor = (
  html: string,
  host: string,
): { evidence: AssetLicenseEvidence; excerpt: string | null; confidence: number } => {
  const normalized = html.replace(/\s+/g, " ").trim();
  const open = normalized.match(
    /.{0,60}(?:creative commons|creativecommons|cc by|royalty[- ]free).{0,100}/iu,
  );
  if (open) return { evidence: "open_license_marker", excerpt: open[0], confidence: 0.85 };
  const explicit = normalized.match(
    /.{0,60}(?:license|licence|attribution|được phép sử dụng).{0,100}/iu,
  );
  if (explicit) return { evidence: "explicit_license", excerpt: explicit[0], confidence: 0.8 };
  if (providerFor(host))
    return { evidence: "provider_license", excerpt: `Provider host: ${host}`, confidence: 0.65 };
  const copyright = normalized.match(/.{0,60}(?:copyright|bản quyền).{0,100}/iu);
  if (copyright)
    return { evidence: "copyright_notice_only", excerpt: copyright[0], confidence: 0.4 };
  return { evidence: "no_license_evidence", excerpt: null, confidence: 0.55 };
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const assetId = (kind: DigitalAssetKind, url: string): string => `asset::${kind}::${url}`;

const isFlagged = (evidence: AssetLicenseEvidence): boolean =>
  evidence === "no_license_evidence" ||
  evidence === "copyright_notice_only" ||
  evidence === "inaccessible" ||
  evidence === "conflicting";

/**
 * Phase 2: extend the reference set with asset references discovered in any
 * directly referenced external stylesheet. Returns the additional references
 * only; the caller is responsible for merging. Catches all network and
 * decode errors and returns an empty list — the dashboard step always
 * succeeds even when the stylesheet fetch fails.
 */
export const collectStylesheetReferences = async (
  baseUrl: string,
  stylesheetUrl: string,
  fetcher: AssetFetcher,
): Promise<AssetReference[]> => {
  const resolved = absoluteUrl(baseUrl, stylesheetUrl);
  if (!resolved || !isAllowedAssetUrl(resolved)) return [];
  const redacted = redactAssetUrl(resolved);
  try {
    const result = await fetcher.fetch(redacted);
    if (result.status < 200 || result.status >= 300) return [];
    if (result.bytes.byteLength > MAX_ASSET_BYTES) return [];
    const css = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(result.bytes);
    return collectAssetReferences(redacted, css);
  } catch {
    return [];
  }
};

/**
 * Phase 3: turn a deduplicated list of asset references into
 * `DigitalAsset` records, with bounded fetches and SSRF guards. Each call
 * resolves at most one `fetchBoundedResource` invocation per reference and
 * never logs raw URLs, query tokens, or PII.
 */
export const classifyAssetRights = async (
  references: readonly AssetReference[],
  fetcher: AssetFetcher,
  contextHtml: string = "",
): Promise<DigitalAssetCollection> => {
  const assets: DigitalAsset[] = [];
  const findings: AssetFinding[] = [];
  for (const ref of references) {
    const parsed = absoluteUrl(ref.sourceUrl, ref.url);
    if (!parsed || !isAllowedAssetUrl(parsed)) continue;
    const redactedUrl = redactAssetUrl(parsed);
    const id = assetId(ref.kind, redactedUrl);
    const evidence = licenseEvidenceFor(contextHtml, parsed.hostname);
    try {
      const result = await fetcher.fetch(redactedUrl);
      if (result.bytes.byteLength > MAX_ASSET_BYTES) throw new Error("asset exceeds size limit");
      const asset: DigitalAsset = {
        id,
        kind: ref.kind,
        url: redactedUrl,
        host: parsed.hostname,
        sourceUrl: ref.sourceUrl,
        contentType: result.contentType,
        sha256: await sha256Hex(result.bytes),
        status: result.status >= 200 && result.status < 300 ? "fetched" : "inaccessible",
        licenseEvidence:
          result.status >= 200 && result.status < 300 ? evidence.evidence : "inaccessible",
        licenseExcerpt: result.status >= 200 && result.status < 300 ? evidence.excerpt : null,
        confidence: result.status >= 200 && result.status < 300 ? evidence.confidence : 0,
      };
      assets.push(asset);
      if (isFlagged(asset.licenseEvidence)) {
        // Severity: `review` (not `high`) per v2 rubric Revision Log 2026-08-06.
        // Web fonts are typically covered by permissive web-embedding licenses
        // (e.g. Google Fonts under SIL OFL, Adobe Fonts ToS). A missing-evidence
        // signal here is a verify-before-launch prompt for a human, not a
        // launch-blocker. See docs/compliance/rubrics/vn-mvp-v2-licensing-
        // digital-rights-strict.md for the full audit trail.
        findings.push({
          id: `digital-rights::${id}`,
          domain: "digital-rights",
          severity: "review",
          rationale:
            "Chưa tìm thấy bằng chứng license cho tài sản này; vui lòng xác minh quyền sử dụng trước khi phát hành (đây là tín hiệu xem xét, không phải kết luận vi phạm).",
          confidence: asset.confidence,
          evidenceIds: [asset.id],
          citations: [COPYRIGHT_CITATION],
          recommendedAction:
            "Kiểm tra hợp đồng, nguồn mua, attribution hoặc quyền sử dụng trước khi phát hành.",
          applicability: "current",
          assetId: asset.id,
        });
      }
    } catch {
      const asset: DigitalAsset = {
        id,
        kind: ref.kind,
        url: redactedUrl,
        host: parsed.hostname,
        sourceUrl: ref.sourceUrl,
        contentType: null,
        sha256: null,
        status: "inaccessible",
        licenseEvidence: "inaccessible",
        licenseExcerpt: null,
        confidence: 0,
      };
      assets.push(asset);
      findings.push({
        id: `digital-rights::${id}`,
        domain: "digital-rights",
        severity: "review",
        rationale:
          "Không thể kiểm tra tài sản số hoặc bằng chứng license; vui lòng xác minh thủ công trước khi phát hành (đây là tín hiệu xem xét, không phải kết luận vi phạm).",
        confidence: 0,
        evidenceIds: [asset.id],
        citations: [COPYRIGHT_CITATION],
        recommendedAction: "Kiểm tra thủ công tài sản và hồ sơ quyền sử dụng.",
        applicability: "current",
        assetId: asset.id,
      });
    }
  }
  const byKind: Record<string, number> = {};
  for (const asset of assets) byKind[asset.kind] = (byKind[asset.kind] ?? 0) + 1;
  return { assets, findings, summary: { total: assets.length, byKind, flagged: findings.length } };
};

/**
 * Convenience helper that runs all three phases sequentially for a single
 * page. Kept for callers (and tests) that want the previous single-call API.
 */
export const collectDigitalAssets = async (input: {
  sourceUrl: string;
  html: string;
  fetcher: AssetFetcher;
}): Promise<DigitalAssetCollection> => {
  const refs = collectAssetReferences(input.sourceUrl, input.html);
  const stylesheets = stylesheetValues(input.html)
    .map((rawUrl) => absoluteUrl(input.sourceUrl, rawUrl))
    .filter((url): url is URL => url !== null && isAllowedAssetUrl(url));
  for (const stylesheet of stylesheets.slice(0, 10)) {
    const additional = await collectStylesheetReferences(
      input.sourceUrl,
      stylesheet.toString(),
      input.fetcher,
    );
    refs.push(...additional);
  }
  const seen = new Set<string>();
  const deduped = refs
    .filter((ref) => {
      const key = `${ref.kind}:${ref.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ASSETS);
  return classifyAssetRights(deduped, input.fetcher, input.html);
};
