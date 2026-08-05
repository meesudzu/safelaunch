import type { SupportedPageType } from "../workflows/scan-workflow";

/**
 * A partial map from a `SupportedPageType` to the actual URL where that
 * page lives on the target site. Missing entries mean "no match found in
 * the homepage — fall back to the legacy `{baseUrl}/{pageType}` URL".
 *
 * The map is intentionally partial: many sites lack a `terms` or `contact`
 * page and we'd rather skip the fetch than 404-then-fail.
 */
export type PageUrlMap = Partial<Record<SupportedPageType, string>>;

/**
 * Keyword sets for each `SupportedPageType`. Used both for anchor-text
 * matching (case-insensitive, accent-folded) and slug fallback matching.
 * Keys are accent-folded + lowercased at match time; values are kept as
 * human-readable originals so future maintainers can read them.
 *
 * Vietnamese keywords come first because that is the dominant locale for
 * the SafeLaunch user base (per the project overview). English keywords
 * are kept as a fallback for international / bilingual sites.
 */
const KEYWORDS: Record<SupportedPageType, readonly string[]> = {
  homepage: [],
  about: ["giới thiệu", "về chúng tôi", "about", "about us", "company"],
  privacy: [
    "chính sách bảo mật",
    "quyền riêng tư",
    "bảo mật thông tin",
    "privacy",
    "privacy policy",
    "privacy notice",
  ],
  terms: [
    "điều khoản",
    "điều khoản sử dụng",
    "quy định",
    "terms",
    "terms of service",
    "terms of use",
  ],
  contact: [
    "liên hệ",
    "tổng biên tập",
    "góp ý",
    "phản hồi",
    "contact",
    "contact us",
    "support",
    "help",
  ],
};

/**
 * NFD + strip combining marks + lowercase. This collapses Vietnamese
 * diacritics (`Giới thiệu` → `gioi thieu`) and accented Latin so a single
 * keyword list works across locales.
 *
 * Public so unit tests can verify the normalization without re-implementing
 * it.
 */
export const normalizeForMatching = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // `đ` (U+0111) and `Đ` (U+0110) are precomposed characters with a
    // stroke through the descender, not a base+diaeresis composition, so
    // NFD does not decompose them. Replace them with plain `d` so
    // Vietnamese keywords (e.g. "điều khoản" → "dieu khoan") match URL
    // slugs and anchor text the same way English keywords do.
    .replace(/[\u0110\u0111]/g, "d")
    .toLowerCase()
    .trim();

/**
 * Match a single normalized string against a list of normalized keywords.
 * Returns the index of the first match, or -1. Used for both anchor text
 * and URL slug matching.
 */
const matchKeyword = (
  normalized: string,
  keywords: readonly string[],
): number => {
  for (let i = 0; i < keywords.length; i += 1) {
    const kw = keywords[i];
    if (!kw) continue;
    const normalizedKw = normalizeForMatching(kw).replace(/[-_]+/g, " ");
    if (normalized.includes(normalizedKw)) return i;
  }
  return -1;
};

/**
 * Extract anchor pairs `<a href="…">anchor text…</a>` from a block of HTML
 * using a deliberately simple regex. We don't need full HTML parsing —
 * the goal is robust matching against real-world footers, not exact
 * DOM fidelity. The regex captures:
 *
 *   group 1 = href attribute value
 *   group 2 = inner text (may contain nested tags, which we strip later)
 */
const ANCHOR_PATTERN = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Resolve `href` against the base URL. Returns null for:
 *   - empty hrefs
 *   - fragment-only anchors (`#foo`)
 *   - mailto / tel / javascript: protocols (not pages)
 *   - cross-origin anchors (host differs from `baseUrl`'s host)
 *
 * Cross-origin rejection is a deliberate choice: the next phase re-runs
 * `validatePublicUrl` for SSRF protection; we don't want to feed it URLs
 * from CDNs / trackers / social widgets.
 */
const resolveSameOrigin = (href: string, baseUrl: string): URL | null => {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.host !== base.host) return null;
  return url;
};

/**
 * Scan a block of HTML for the best URL of each `SupportedPageType`.
 *
 * Matching precedence (first match wins):
 *   1. Anchor text matches a keyword for the page type.
 *   2. URL slug (last path segment, accent-folded) matches a keyword.
 *
 * If no `<footer>` is found, the function falls back to the last 30% of
 * the homepage HTML — captures link lists that live in `<ul>`/`<nav>`
 * at the bottom of `<body>` without a `<footer>` wrapper.
 */
export const discoverPageUrls = (baseUrl: string, homepageHtml: string): PageUrlMap => {
  const footerMatch = /<footer\b[^>]*>([\s\S]*?)<\/footer>/iu.exec(homepageHtml);
  let region: string;
  if (footerMatch && footerMatch[1]) {
    region = footerMatch[1];
  } else {
    const cutoff = Math.floor(homepageHtml.length * 0.7);
    region = homepageHtml.slice(cutoff);
  }

  const result: PageUrlMap = {};
  for (const match of region.matchAll(ANCHOR_PATTERN)) {
    const rawHref = match[1];
    if (!rawHref) continue;
    const url = resolveSameOrigin(rawHref, baseUrl);
    if (!url) continue;
    const anchorText = stripTags(match[2] ?? "");
    // Collect ALL path segments so deep URLs like
    // `/cong-nghe/chinh-sach-bao-mat-du-lieu.htm` still match the
    // `chinh sach bao mat` keyword in their inner segments. Order is
    // preserved (last segment first) so terminal-segment links still win
    // ties.
    const segments = url.pathname.split(/[/.]/).filter(Boolean);
    const normalizedAnchor = normalizeForMatching(anchorText);
    const normalizedSegments = segments.map((seg) =>
      normalizeForMatching(seg).replace(/[-_]+/g, " "),
    );

    for (const pageType of ["about", "privacy", "terms", "contact"] as const) {
      if (result[pageType]) continue;
      const keywords = KEYWORDS[pageType];
      // Precedence: anchor text first, then slug.
      if (normalizedAnchor && matchKeyword(normalizedAnchor, keywords) >= 0) {
        result[pageType] = url.toString();
        continue;
      }
      // Match against ANY segment of the path (last-first order). This
      // handles both shallow slugs (`/chinh-sach-bao-mat.html`) and
      // nested news URLs (`/cong-nghe/chinh-sach-bao-mat-du-lieu.htm`).
      for (const seg of normalizedSegments) {
        if (seg && matchKeyword(seg, keywords) >= 0) {
          result[pageType] = url.toString();
          break;
        }
      }
    }
  }
  return result;
};
