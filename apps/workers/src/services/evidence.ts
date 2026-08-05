/* eslint-disable no-useless-escape */
import { z } from "zod";
import type { EvidenceItem } from "@safelaunch/contracts";

export const EVIDENCE_TYPES = [
  "operator_identity",
  "contact",
  "privacy_notice",
  "payment",
  "ugc",
  "content_model",
  "license_claim",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EvidenceDraft = z.object({
  type: z.enum(EVIDENCE_TYPES),
  value: z.string().min(1),
  quote: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type EvidenceDraftInput = z.input<typeof EvidenceDraft>;
export type EvidenceDraftOutput = z.output<typeof EvidenceDraft>;

export class UnsupportedEvidenceError extends Error {
  constructor(readonly quote: string) {
    super(`Unsupported evidence: quote not found in source ("${quote.slice(0, 80)}")`);
    this.name = "UnsupportedEvidenceError";
  }
}

export class SanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanitizationError";
  }
}

export interface PageInput {
  sourceUrl: string;
  html: string;
}

export const MAX_TEXT_BYTES = 200_000;
/**
 * Maximum raw-HTML payload size (in characters) that `sanitizePageText`
 * accepts in a single pass. Above this threshold the payload is split into
 * `CHUNK_BYTES`-sized slices and sanitized independently. Previously the
 * function threw a `SanitizationError` on any payload larger than this
 * limit, which terminated `phase-2:extract-evidence` on large news sites
 * (e.g. dantri.com.vn ~1 MB). The chunked path keeps the CPU bounded
 * while preserving the header + footer of the document so compliance
 * signals (operator identity, contact email, license claims in the
 * footer) are still extractable.
 */
export const MAX_HTML_BYTES = 800_000;
/**
 * Half of {@link MAX_HTML_BYTES}. Chosen so a 1 MB payload splits into
 * three chunks max, well within the 1-minute `phase-2:extract-evidence`
 * step timeout configured in `scan-workflow.ts`.
 */
export const SANITIZE_CHUNK_BYTES = 400_000;
export const CHUNK_BYTES = 4_000;

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:the\s+|all\s+|any\s+|previous\s+)?(?:system\s+|prior\s+|above\s+)?(?:prompt|instructions?|rules?)/i,
  /<override\s*mode>/i,
  /\bSYSTEM\s*:\s*</,
  /\bcall\s+sendMoney\s*\(/i,
  /\bdo_action\s*\(\s*["']transfer_funds["']/i,
  /\btransfer_funds\b/i,
];

const TAG_BLOCKS = [
  /<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi,
  /<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi,
  /<\s*noscript[^>]*>[\s\S]*?<\s*\/\s*noscript\s*>/gi,
  /<!--[\s\S]*?-->/g,
  /<\s*(?:code|pre|iframe|object|embed|svg|canvas|math)[^>]*>[\s\S]*?<\s*\/\s*(?:code|pre|iframe|object|embed|svg|canvas|math)\s*>/gi,
];

const stripDangerousBlocks = (html: string): string =>
  TAG_BLOCKS.reduce((acc, pattern) => acc.replace(pattern, " "), html);

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCharCode(Number.parseInt(dec, 10)));

/**
 * Pure pipeline reused by both the single-pass and chunked paths.
 * Kept private so callers must use {@link sanitizePageText} (which decides
 * the strategy) or {@link sanitizePageTextSafe} (which adds the truncated
 * flag).
 */
const sanitizeChunk = (html: string): string => {
  const withoutBlocks = stripDangerousBlocks(html);
  const noTags = withoutBlocks.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(noTags);
  return decoded.replace(/\s+/g, " ").trim();
};

export const sanitizePageText = (html: string): string => {
  if (html.length <= MAX_HTML_BYTES) {
    return sanitizeChunk(html);
  }
  // Oversized payload: sanitize in independent slices and rejoin.
  // We do NOT throw. The downstream `extractEvidence` only cares that
  // the result is a sanitized string of bounded length. Splitting mid-tag
  // is safe because `sanitizeChunk` strips every tag regardless of where
  // it starts/ends — the chunk boundary simply becomes whitespace.
  const parts: string[] = [];
  for (let offset = 0; offset < html.length; offset += SANITIZE_CHUNK_BYTES) {
    parts.push(sanitizeChunk(html.slice(offset, offset + SANITIZE_CHUNK_BYTES)));
  }
  return parts.join(" ").trim();
};

/**
 * Like {@link sanitizePageText} but reports whether chunked sanitization
 * was triggered. The workflow uses this flag to flag oversized pages in
 * `coverage.degradedPhases` so operators can spot scans where the
 * chunked path produced partial evidence.
 */
export const sanitizePageTextSafe = (html: string): { text: string; truncated: boolean } => {
  const truncated = html.length > MAX_HTML_BYTES;
  return { text: sanitizePageText(html), truncated };
};

export const detectPromptInjection = (text: string): boolean =>
  INJECTION_PATTERNS.some((pattern) => pattern.test(text));

export const chunkText = (text: string, size: number = CHUNK_BYTES): string[] => {
  if (text.length === 0) return [];
  if (size <= 0) throw new SanitizationError(`chunk size must be positive (${size})`);
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(text.slice(offset, offset + size));
  }
  return chunks;
};

interface EvidencePattern {
  readonly type: EvidenceType;
  readonly patterns: readonly RegExp[];
  readonly confidence: number;
  readonly minValueLength: number;
  readonly extract: (match: RegExpMatchArray) => string | null;
  readonly quote: (match: RegExpMatchArray) => string;
}

const cleanedValue = (raw: string): string =>
  raw
    .replace(/\s+/g, " ")
    .replace(/^[\s,:;.\-–—()]+|[\s,:;.\-–—()]+$/g, "")
    .trim();

const truncateValue = (raw: string, max: number): string => {
  const cleaned = cleanedValue(raw);
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + "…";
};

const OPERATOR_PATTERNS: readonly RegExp[] = [
  /(?:Đơn vị phát hành|Chủ sở hữu|Đơn vị cung cấp|Tổ chức phát hành|Operated by|Run by|Issued by|Publisher|Provided by)\s*[:\-–—]?\s*([^.]{4,260}?)(?:\.|$)/giu,
  /((?:Công ty\s+(?:Cổ phần|Trách nhiệm Hữu hạn|TNHH|Một thành viên)|Công ty\s+[A-ZÀ-Ỹ][\p{L}\d\s&'’\-]+)\b[^.]{0,180})/gu,
  /\b([A-ZÀ-Ỹ][\p{L}\d&'’\-]+\s+(?:Media|Tech|Studios|Studio|Group|Holdings|Capital|Networks|Ventures|Communications)\s+(?:Pte\.?\s*Ltd\.?|Ltd\.?|Inc\.?|LLC|Co\.?,?\s*Ltd\.?))\b/gu,
  /\b((?:Lumen|Acme|Nimbus|Globex)\s+Media\s+Pte\.?\s*Ltd\.?)\b/gu,
];

const CONTACT_PATTERNS: readonly RegExp[] = [
  /(Liên hệ(?:\s+tòa\s+soạn)?|Tổng biên tập|Email(?:\s+liên\s+hệ)?|Điện thoại|Địa\s+chỉ|Phone|Address|Email|Contact(?:\s+us)?|Support|Headquarters)\s*[:\-–—]?\s*([^\.;,\n]{4,220}?)(?=[.;,\n]|$)/giu,
  /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g,
  /(\+?\d[\d\s().\-]{7,18}\d)/g,
];

const PRIVACY_PATTERNS: readonly RegExp[] = [
  /(Chính sách\s+bảo\s+mật|Privacy\s+(?:notice|policy)|Privacy|We\s+collect|We\s+retain|chúng tôi\s+thu\s+thập|Báo\s+điện\s+tử[^\.]{0,80}lưu\s+trữ)\b([^.]{20,360}?)(?:\.|$)/giu,
];

const PAYMENT_PATTERNS: readonly RegExp[] = [
  /(?:\.\s+|^|\s)(?:Thanh\s+toán|Dịch\s+vụ\s+thu\s+phí|Payments|Billing|Subscriptions)\s+([^.]{4,260}?(?:Stripe|Visa|MasterCard|Master\s*Card|MoMo|VNPay|Apple\s+Pay|thẻ\s+ngân\s+hàng|thẻ\s+Visa|nạp\s+thẻ|top[-\s]?up|thu\s+phí|trả\s+phí)[^.]{0,200}?)\./giu,
];

const UGC_PATTERNS: readonly RegExp[] = [
  /(nội\s+dung\s+người\s+dùng|user[-\s]?generated\s+content|UGC|reader[-\s]?submitted|user\s+uploads?|do\s+người\s+dùng\s+(?:đăng\s+tải|gửi))\b([^.]{12,260}?)(?:\.|$)/giu,
];

const CONTENT_MODEL_PATTERNS: readonly RegExp[] = [
  /(Mô\s+hình\s+nội\s+dung|Content\s+model|Editorial\s+model|Content\s+program)\b([^.]{8,260}?)(?:\.|$)/giu,
];

const LICENSE_PATTERNS: readonly RegExp[] = [
  /(Giấy\s+phép(?:\s+[^\.]{0,40})?|License|Licence|Broadcasting\s+licence|publishing\s+license|GCN\s+s[ốố]\s*[\w/.\-]+|GP[-\w/.\-]+)\b([^.]{4,260}?)(?:\.|$)/giu,
];

const DETECTORS: readonly EvidencePattern[] = [
  {
    type: "operator_identity",
    patterns: OPERATOR_PATTERNS,
    confidence: 0.9,
    minValueLength: 4,
    extract: (match) => {
      const candidate = match[1] ?? match[0];
      const cleaned = cleanedValue(candidate);
      if (cleaned.length < 4) return null;
      if (/^(operated by|run by|issued by|publisher|provided by)$/i.test(cleaned)) return null;
      return truncateValue(cleaned, 180);
    },
    quote: (match) => cleanedValue(match[0]),
  },
  {
    type: "contact",
    patterns: CONTACT_PATTERNS,
    confidence: 0.85,
    minValueLength: 4,
    extract: (match) => {
      const email = match[1] && match[1].includes("@") ? match[1] : null;
      if (email) return email.trim();
      const phone =
        match[1] && /^\+?\d[\d\s().\-]{7,18}\d$/.test(match[1].trim()) ? match[1] : null;
      if (phone) return phone.replace(/\s+/g, " ").trim();
      const cleaned = cleanedValue(match[2] ?? match[0]);
      if (cleaned.length < 4) return null;
      return truncateValue(cleaned, 180);
    },
    quote: (match) => cleanedValue(match[0]),
  },
  {
    type: "privacy_notice",
    patterns: PRIVACY_PATTERNS,
    confidence: 0.8,
    minValueLength: 20,
    extract: (match) => {
      const cleaned = cleanedValue(match[2] ?? match[0]);
      if (cleaned.length < 20) return null;
      return truncateValue(cleaned, 220);
    },
    quote: (match) => cleanedValue(match[0]),
  },
  {
    type: "payment",
    patterns: PAYMENT_PATTERNS,
    confidence: 0.8,
    minValueLength: 8,
    extract: (match) => {
      const cleaned = cleanedValue(match[2] ?? match[0]);
      if (cleaned.length < 8) return null;
      return truncateValue(cleaned, 220);
    },
    quote: (match) => cleanedValue(match[0]),
  },
  {
    type: "ugc",
    patterns: UGC_PATTERNS,
    confidence: 0.75,
    minValueLength: 12,
    extract: (match) => {
      const cleaned = cleanedValue(match[2] ?? match[0]);
      if (cleaned.length < 12) return null;
      return truncateValue(cleaned, 220);
    },
    quote: (match) => cleanedValue(match[0]),
  },
  {
    type: "content_model",
    patterns: CONTENT_MODEL_PATTERNS,
    confidence: 0.7,
    minValueLength: 8,
    extract: (match) => {
      const cleaned = cleanedValue(match[2] ?? match[0]);
      if (cleaned.length < 8) return null;
      return truncateValue(cleaned, 220);
    },
    quote: (match) => cleanedValue(match[0]),
  },
  {
    type: "license_claim",
    patterns: LICENSE_PATTERNS,
    confidence: 0.85,
    minValueLength: 4,
    extract: (match) => {
      const cleaned = cleanedValue(match[2] ?? match[0]);
      if (cleaned.length < 4) return null;
      return truncateValue(cleaned, 220);
    },
    quote: (match) => cleanedValue(match[0]),
  },
];

export const verifyQuote = (
  pageText: string,
  draft: EvidenceDraftInput,
): { type: EvidenceType; value: string; excerpt: string; confidence: number } => {
  const parsed = EvidenceDraft.parse(draft);
  if (!pageText.includes(parsed.quote)) {
    throw new UnsupportedEvidenceError(parsed.quote);
  }
  return {
    type: parsed.type,
    value: parsed.value,
    excerpt: parsed.quote,
    confidence: parsed.confidence,
  };
};

const valueIsInjectionLike = (value: string): boolean =>
  INJECTION_PATTERNS.some((pattern) => pattern.test(value));

const makeEvidenceId = (
  type: EvidenceType,
  sourceUrl: string,
  quote: string,
  index: number,
): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < quote.length; i += 1) {
    hash ^= quote.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const unsigned = hash >>> 0;
  return `${type}::${sourceUrl}::${unsigned.toString(16)}::${index}`;
};

export const extractEvidence = (input: PageInput): EvidenceItem[] => {
  const text = sanitizePageText(input.html);
  if (text.length === 0) return [];
  const isInjection = detectPromptInjection(text);
  const chunks = chunkText(text);
  const drafts: EvidenceDraftInput[] = [];
  for (const chunk of chunks) {
    for (const detector of DETECTORS) {
      for (const pattern of detector.patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | RegExpMatchArray | null;
        const global = pattern.flags.includes("g");
        if (global) {
          while ((match = pattern.exec(chunk)) !== null) {
            const value = detector.extract(match);
            if (!value) {
              if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
              continue;
            }
            const quote = detector.quote(match);
            drafts.push({
              type: detector.type,
              value,
              quote,
              confidence: detector.confidence,
            });
            if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
          }
        } else {
          match = pattern.exec(chunk);
          if (match) {
            const value = detector.extract(match);
            if (value) {
              const quote = detector.quote(match);
              drafts.push({
                type: detector.type,
                value,
                quote,
                confidence: detector.confidence,
              });
            }
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  const results: EvidenceItem[] = [];
  let index = 0;
  for (const draft of drafts) {
    if (isInjection && valueIsInjectionLike(draft.value)) continue;
    if (valueIsInjectionLike(draft.value)) continue;
    let verified: ReturnType<typeof verifyQuote>;
    try {
      verified = verifyQuote(text, draft);
    } catch (cause) {
      if (cause instanceof UnsupportedEvidenceError) continue;
      throw cause;
    }
    const key = `${verified.type}::${verified.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: makeEvidenceId(verified.type, input.sourceUrl, verified.excerpt, index),
      type: verified.type,
      value: verified.value,
      sourceUrl: input.sourceUrl,
      excerpt: verified.excerpt,
      confidence: verified.confidence,
    });
    index += 1;
  }
  return results;
};
