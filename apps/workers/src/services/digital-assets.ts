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
  provisionId: "vn-digital-rights-review",
  source: "Cổng thông tin pháp luật quốc gia — cần đối chiếu quyền sử dụng tài sản số",
  url: "https://vbpl.vn/",
  retrievedAt: "2026-08-04T00:00:00.000Z",
  excerpt:
    "Cần kiểm tra nguồn mua, hợp đồng, attribution và quyền sử dụng trước khi phát hành tài sản số.",
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

const srcsetValues = (html: string): string[] =>
  attributeValues(html, "(?:img|source)", "srcset").flatMap((value) =>
    value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? ""),
  );

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

export const collectAssetReferences = (sourceUrl: string, html: string): AssetReference[] => {
  const refs: AssetReference[] = [];
  addReferences(refs, sourceUrl, sourceUrl, "image", [
    ...attributeValues(html, "img", "src"),
    ...attributeValues(html, "picture", "src"),
    ...attributeValues(html, "meta", "content").filter((value) =>
      /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/iu.test(value),
    ),
    ...srcsetValues(html),
  ]);
  addReferences(refs, sourceUrl, sourceUrl, "audio", [
    ...attributeValues(html, "audio", "src"),
    ...attributeValues(html, "source", "src").filter((value) =>
      /\.(?:mp3|wav|ogg|m4a|aac)(?:[?#]|$)/iu.test(value),
    ),
  ]);
  addReferences(refs, sourceUrl, sourceUrl, "video", [
    ...attributeValues(html, "video", "src"),
    ...attributeValues(html, "source", "src").filter((value) =>
      /\.(?:mp4|webm|mov|m3u8)(?:[?#]|$)/iu.test(value),
    ),
  ]);
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
  addReferences(
    refs,
    sourceUrl,
    sourceUrl,
    "image",
    cssUrls(html).filter((value) => !/\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/iu.test(value)),
  );

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

export const collectDigitalAssets = async (input: {
  sourceUrl: string;
  html: string;
  fetcher: AssetFetcher;
}): Promise<DigitalAssetCollection> => {
  let refs = collectAssetReferences(input.sourceUrl, input.html);
  // Follow only directly referenced stylesheets, and only one level deep. This
  // covers @font-face and CSS background URLs without turning the scan into a
  // site crawler.
  const stylesheets = stylesheetValues(input.html)
    .map((rawUrl) => absoluteUrl(input.sourceUrl, rawUrl))
    .filter((url): url is URL => url !== null && isAllowedAssetUrl(url));
  for (const stylesheet of stylesheets.slice(0, 10)) {
    try {
      const result = await input.fetcher.fetch(redactAssetUrl(stylesheet));
      if (result.status < 200 || result.status >= 300 || result.bytes.byteLength > MAX_ASSET_BYTES)
        continue;
      const css = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(result.bytes);
      refs = [...refs, ...collectAssetReferences(redactAssetUrl(stylesheet), css)];
    } catch {
      // The stylesheet itself is coverage metadata; an inaccessible stylesheet
      // is reported through the page/asset coverage rather than logged with a URL.
    }
  }
  const seenReferences = new Set<string>();
  refs = refs
    .filter((ref) => {
      const key = `${ref.kind}:${ref.url}`;
      if (seenReferences.has(key)) return false;
      seenReferences.add(key);
      return true;
    })
    .slice(0, MAX_ASSETS);
  const assets: DigitalAsset[] = [];
  const findings: AssetFinding[] = [];
  for (const ref of refs) {
    const parsed = absoluteUrl(input.sourceUrl, ref.url);
    if (!parsed || !isAllowedAssetUrl(parsed)) continue;
    const redactedUrl = redactAssetUrl(parsed);
    const id = assetId(ref.kind, redactedUrl);
    const evidence = licenseEvidenceFor(input.html, parsed.hostname);
    try {
      const result = await input.fetcher.fetch(redactedUrl);
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
        findings.push({
          id: `digital-rights::${id}`,
          domain: "digital-rights",
          severity: "high",
          rationale:
            "Chưa tìm thấy bằng chứng license cho tài sản này; đây là tín hiệu rủi ro, không phải kết luận vi phạm.",
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
        severity: "high",
        rationale:
          "Không thể kiểm tra tài sản số hoặc bằng chứng license; đây là tín hiệu rủi ro, không phải kết luận vi phạm.",
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
