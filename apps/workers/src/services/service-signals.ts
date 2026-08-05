import type { ServiceSignal, ServiceSignalKind } from "@safelaunch/contracts";
import { detectPromptInjection, sanitizePageText } from "./evidence";

export interface ServiceSignalInput {
  sourceUrl: string;
  html: string;
}

type Detector = {
  kind: ServiceSignalKind;
  confidence: number;
  patterns: readonly RegExp[];
};

const DETECTORS: readonly Detector[] = [
  {
    kind: "login",
    confidence: 0.9,
    patterns: [
      /(?:đăng nhập|đăng ký|login|log in|sign in|sign up|register|create account)\b/iu,
      /<input[^>]+type\s*=\s*["']?password\b/iu,
    ],
  },
  {
    kind: "ugc",
    confidence: 0.9,
    patterns: [
      /(?:đăng bài|tạo bài viết|nội dung người dùng|user[- ]generated content|upload bài|submit post|write a review)\b/iu,
      /(?:bài viết|bài đăng)\s+(?:của|từ)\s+(?:người dùng|thành viên)\b/iu,
    ],
  },
  {
    kind: "public_profile",
    confidence: 0.85,
    patterns: [
      /\b(?:hồ sơ(?: người dùng| thành viên)?|trang cá nhân|user profile|member profile|public profile)\b/iu,
    ],
  },
  {
    kind: "content_feed",
    confidence: 0.8,
    patterns: [
      /\b(?:bảng tin|news\s*feed|activity\s*feed|community\s*feed|dòng thời gian|timeline)\b/iu,
    ],
  },
  {
    kind: "follow_or_friend",
    confidence: 0.8,
    patterns: [/\b(?:theo dõi|kết bạn|follow|following|add friend|friend request)\b/iu],
  },
  {
    kind: "comment",
    confidence: 0.8,
    patterns: [/\b(?:bình luận|nhận xét|comment|reply to this post|phản hồi)\b/iu],
  },
  {
    kind: "share",
    confidence: 0.8,
    patterns: [/\b(?:chia sẻ|share|repost|đăng lại|send to friends)\b/iu],
  },
  {
    kind: "editorial_publishing",
    confidence: 0.9,
    patterns: [
      /\b(?:tòa soạn|toà soạn|báo điện tử|tin tức|newsroom|editorial desk|press publication)\b/iu,
    ],
  },
];

const evidenceId = (kind: ServiceSignalKind, sourceUrl: string): string => {
  let hash = 0x811c9dc5;
  const value = `${kind}:${sourceUrl}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `service_signal::${kind}::${(hash >>> 0).toString(16)}`;
};

export const detectServiceSignals = (input: ServiceSignalInput): ServiceSignal[] => {
  const text = sanitizePageText(input.html);
  if (text.length === 0 && input.html.length === 0) return [];
  const pageContainsInjection = detectPromptInjection(text);
  const signals: ServiceSignal[] = [];

  for (const detector of DETECTORS) {
    let matched: RegExpExecArray | null = null;
    const searchable = detector.kind === "login" ? `${text} ${input.html}` : text;
    for (const pattern of detector.patterns) {
      pattern.lastIndex = 0;
      const candidate = pattern.exec(searchable);
      if (candidate) {
        matched = candidate;
        break;
      }
    }
    if (!matched) continue;
    const excerpt = matched[0].replace(/\s+/g, " ").trim().slice(0, 220);
    if (pageContainsInjection && detectPromptInjection(matched[0])) continue;
    signals.push({
      id: evidenceId(detector.kind, input.sourceUrl),
      kind: detector.kind,
      observed: true,
      confidence: detector.confidence,
      sourceUrl: input.sourceUrl,
      excerpt,
      evidenceId: evidenceId(detector.kind, input.sourceUrl),
    });
  }
  return signals;
};
