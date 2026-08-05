import { type EvidenceItem, type LegalCitation, type ScanCoverage } from "@safelaunch/contracts";
type AppCategoryLike = "online_game" | "electronic_press" | "digital_entertainment";
import { RUBRIC_VERSION, severityFor } from "./scoring";
import type { RuleOutcome, RuleSeverity } from "./scoring";
export type { RuleOutcome, RuleSeverity };
export { RUBRIC_VERSION };
import { supportsCategory } from "./jurisdictions";

export interface RuleInput {
  scanId: string;
  jurisdiction: string;
  category: AppCategoryLike;
  coverage: ScanCoverage;
  evidence: readonly EvidenceItem[];
}

export interface RuleCitation {
  readonly provisionId: string;
  readonly source: string;
  readonly excerpt: string;
}

export interface RuleResult {
  readonly ruleId: string;
  readonly title: string;
  readonly outcome: RuleOutcome;
  readonly severity: RuleSeverity;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly citations: readonly RuleCitation[];
  readonly rubricVersion: string;
  readonly applicability: "current" | "upcoming";
  readonly categories: readonly AppCategoryLike[];
}

interface RuleDefinition {
  readonly id: string;
  readonly title: string;
  readonly categories: readonly AppCategoryLike[];
  readonly requiredPages: readonly ("homepage" | "about" | "privacy" | "contact" | "terms")[];
  readonly evidenceTypes: readonly string[];
  readonly citation: LegalCitation;
  readonly presentRationale: string;
  readonly absentRationale: string;
  readonly unknownRationale: string;
}

const CITATION_RETRIEVED_AT = "2026-07-29T00:00:00.000Z";

const PRIVACY_PROVISION_ID = "vn-pd-2025-privacy-notice";
const OPERATOR_PROVISION_ID = "vn-pd-2025-operator-identity";
const CONTACT_PROVISION_ID = "vn-pd-2025-contact-channel";

const baseCitation = (
  provisionId: string,
  source: string,
  url: string,
  excerpt: string,
): LegalCitation => ({
  provisionId,
  source,
  url,
  retrievedAt: CITATION_RETRIEVED_AT,
  excerpt,
});

const PRIVACY_CITATION: LegalCitation = baseCitation(
  PRIVACY_PROVISION_ID,
  "Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân",
  "https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=210924",
  "Tổ chức, cá nhân xử lý dữ liệu cá nhân phải thông báo cho chủ thể dữ liệu về mục đích, phạm vi xử lý trước khi tiến hành xử lý.",
);

const OPERATOR_CITATION: LegalCitation = baseCitation(
  OPERATOR_PROVISION_ID,
  "Nghị định 72/2013/NĐ-CP về quản lý dịch vụ trò chơi điện tử",
  "https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=18370",
  "Doanh nghiệp cung cấp dịch vụ phải công khai tên, địa chỉ, số điện thoại liên hệ trên trang thông tin điện tử của mình.",
);

const LICENSE_GAME_PROVISION_ID = "vn-pd-72-2013-game-license";
const LICENSE_GAME_CITATION: LegalCitation = baseCitation(
  LICENSE_GAME_PROVISION_ID,
  "Nghị định 72/2013/NĐ-CP về quản lý dịch vụ trò chơi điện tử",
  "https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=18370",
  "Doanh nghiệp cung cấp dịch vụ trò chơi điện tử phải có giấy phép phát hành còn hiệu lực.",
);

const CONTACT_CITATION: LegalCitation = baseCitation(
  CONTACT_PROVISION_ID,
  "Luật An toàn thông tin mạng 2015",
  "https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=25914",
  "Tổ chức, doanh nghiệp cung cấp dịch vụ trên mạng phải công bố thông tin liên lạc để tiếp nhận phản ánh của người sử dụng.",
);

const RULES: readonly RuleDefinition[] = [
  {
    id: "privacy-notice",
    title: "Công khai chính sách bảo mật",
    categories: ["online_game", "electronic_press", "digital_entertainment"],
    requiredPages: ["privacy"],
    evidenceTypes: ["privacy_notice"],
    citation: PRIVACY_CITATION,
    presentRationale:
      "Đã phát hiện privacy / chính sách bảo mật nêu rõ dữ liệu cá nhân được thu thập và mục đích xử lý.",
    absentRationale:
      "Không tìm thấy privacy / chính sách bảo mật công khai; đề xuất bổ sung trước khi ra mắt.",
    unknownRationale:
      "Chưa xác định được privacy / chính sách bảo mật vì trang liên quan không thể truy cập trong lần quét này.",
  },
  {
    id: "operator-identity",
    title: "Công khai thông tin đơn vị phát hành",
    categories: ["online_game", "electronic_press", "digital_entertainment"],
    requiredPages: ["about"],
    evidenceTypes: ["operator_identity"],
    citation: OPERATOR_CITATION,
    presentRationale:
      "Đã phát hiện thông tin đơn vị vận hành (tên pháp lý và/hoặc người chịu trách nhiệm) trên trang giới thiệu.",
    absentRationale:
      "Không tìm thấy thông tin đơn vị phát hành rõ ràng; cần bổ sung trước khi ra mắt.",
    unknownRationale:
      "Chưa xác định được đơn vị phát hành vì trang giới thiệu không thể truy cập trong lần quét này.",
  },
  {
    id: "license-claim-game",
    title: "Công khai giấy phép phát hành trò chơi điện tử",
    categories: ["online_game"],
    requiredPages: ["about", "terms"],
    evidenceTypes: ["license_claim"],
    citation: LICENSE_GAME_CITATION,
    presentRationale:
      "Đã phát hiện giấy phép phát hành trò chơi điện tử còn hiệu lực được công khai trên trang.",
    absentRationale:
      "Không tìm thấy giấy phép phát hành trò chơi điện tử; cần xuất trình trước khi ra mắt.",
    unknownRationale:
      "Chưa xác định được giấy phép phát hành vì trang giới thiệu hoặc điều khoản không thể truy cập.",
  },
  {
    id: "contact-info",
    title: "Công khai kênh liên hệ",
    categories: ["online_game", "electronic_press", "digital_entertainment"],
    requiredPages: ["contact"],
    evidenceTypes: ["contact"],
    citation: CONTACT_CITATION,
    presentRationale: "Đã phát hiện kênh liên hệ (email hoặc số điện thoại) trên trang liên hệ.",
    absentRationale: "Không tìm thấy kênh liên hệ công khai; cần bổ sung trước khi ra mắt.",
    unknownRationale:
      "Chưa xác định được kênh liên hệ vì trang liên hệ không thể truy cập trong lần quét này.",
  },
];

const pageIsFailed = (
  coverage: ScanCoverage,
  page: "homepage" | "about" | "privacy" | "contact" | "terms",
): boolean => coverage.failed.includes(page);

const pageWasFetched = (
  coverage: ScanCoverage,
  page: "homepage" | "about" | "privacy" | "contact" | "terms",
): boolean => coverage.fetched.includes(page);

const hasEvidenceFor = (
  evidence: readonly EvidenceItem[],
  rule: RuleDefinition,
): readonly EvidenceItem[] => {
  const matches: EvidenceItem[] = [];
  for (const item of evidence) {
    if (rule.evidenceTypes.includes(item.type)) matches.push(item);
  }
  return matches;
};

const buildCitations = (rule: RuleDefinition): readonly RuleCitation[] => [
  {
    provisionId: rule.citation.provisionId,
    source: rule.citation.source,
    excerpt: rule.citation.excerpt,
  },
];

const buildRuleResult = (
  rule: RuleDefinition,
  outcome: RuleOutcome,
  matchedEvidence: readonly EvidenceItem[],
): RuleResult => {
  const rationaleByOutcome: Record<RuleOutcome, string> = {
    present: rule.presentRationale,
    absent: rule.absentRationale,
    unknown: rule.unknownRationale,
  };
  const citations = outcome === "unknown" ? [] : buildCitations(rule);
  return {
    ruleId: rule.id,
    title: rule.title,
    outcome,
    severity: severityFor(outcome),
    rationale: rationaleByOutcome[outcome],
    evidenceIds: outcome === "absent" ? [] : matchedEvidence.map((item) => item.id),
    citations,
    rubricVersion: RUBRIC_VERSION,
    applicability: "current",
    categories: rule.categories,
  };
};

const evaluateRule = (rule: RuleDefinition, input: RuleInput): RuleResult => {
  const allRequiredFailed = rule.requiredPages.every((page) => pageIsFailed(input.coverage, page));
  const anyRequiredFailed = rule.requiredPages.some((page) => pageIsFailed(input.coverage, page));
  const anyRequiredFetched = rule.requiredPages.some((page) =>
    pageWasFetched(input.coverage, page),
  );
  const matched = hasEvidenceFor(input.evidence, rule);
  if (matched.length > 0) {
    return buildRuleResult(rule, "present", matched);
  }
  if (allRequiredFailed || (anyRequiredFailed && !anyRequiredFetched)) {
    return buildRuleResult(rule, "unknown", []);
  }
  if (rule.requiredPages.every((page) => pageWasFetched(input.coverage, page))) {
    return buildRuleResult(rule, "absent", []);
  }
  return buildRuleResult(rule, "unknown", []);
};

export const runRules = (input: RuleInput): readonly RuleResult[] => {
  const category: AppCategoryLike = input.category;
  const filteredRules = RULES.filter(
    (rule) => rule.categories.includes(category) && supportsCategory(input.jurisdiction, category),
  );
  return filteredRules.map((rule) => evaluateRule(rule, input));
};

export const listRuleIds = (category: AppCategoryLike): readonly string[] =>
  RULES.filter((rule) => rule.categories.includes(category)).map((rule) => rule.id);
