import type {
  LicenseCheck,
  LegalCitation,
  ServiceSignal,
  ServiceSignalKind,
} from "@safelaunch/contracts";
import type { LegalCitation as ContractCitation } from "@safelaunch/contracts";
import { RUBRIC_VERSION } from "./scoring";

type SupportedCategory = "online_game" | "electronic_press" | "digital_entertainment";

export type LicenseClaim = {
  value: string;
  evidenceId: string;
  sourceUrl: string;
};

export type LicenseRegistryResult = {
  licenseType: string;
  status: "verified" | "not_found" | "mismatch" | "expired" | "ambiguous" | "unavailable";
  sourceUrl?: string;
  retrievedAt: string;
  matchedSubject?: string;
  licenseNumber?: string;
  validFrom?: string | null;
  validTo?: string | null;
  rationale: string;
};

export interface LicenseRegistryAdapter {
  lookup(input: {
    jurisdiction: string;
    licenseType: string;
    operatorName?: string;
    licenseNumber?: string;
  }): Promise<LicenseRegistryResult>;
}

export interface LicenseEvaluationInput {
  jurisdiction: string;
  category: SupportedCategory;
  signals: readonly ServiceSignal[];
  licenseClaims: readonly LicenseClaim[];
  registry: LicenseRegistryResult | undefined;
  on: string;
}

const CITATION_RETRIEVED_AT = "2026-08-05T00:00:00.000Z";

const citation = (
  provisionId: string,
  source: string,
  excerpt: string,
  url = "https://vbpl.vn/",
): ContractCitation => ({
  provisionId,
  source,
  url,
  retrievedAt: CITATION_RETRIEVED_AT,
  excerpt,
});

const GAME_CITATION = citation(
  "vn-pd-72-2013-game-license",
  "Nghị định 72/2013/NĐ-CP về quản lý dịch vụ trò chơi điện tử",
  "Doanh nghiệp cung cấp dịch vụ trò chơi điện tử phải có giấy phép phát hành còn hiệu lực.",
  "https://vbpl.vn/van-ban/trung-uong/nghi-dinh-72-2013-nd-cp",
);

const PRESS_CITATION = citation(
  "vn-press-2016-electronic-press",
  "Luật Báo chí 2016",
  "Báo điện tử phải có giấy phép do cơ quan có thẩm quyền cấp và tuân thủ các điều kiện về tổ chức, biên tập.",
  "https://vbpl.vn/van-ban/trung-uong/luat-bao-chi-2016",
);

/**
 * Citation for the social-network license gate.
 *
 * Source of authority: Nghị định 27/2018/NĐ-CP (which amends Nghị định
 * 72/2013/NĐ-CP) defines "mạng xã hội" (social network) and the four
 * community/sharing behaviors that distinguish it from a generic
 * identity-only service.
 */
const SOCIAL_CITATION = citation(
  "vn-pd-27-2018-social-network",
  "Nghị định 27/2018/NĐ-CP sửa đổi, bổ sung Nghị định 72/2013/NĐ-CP",
  "Dịch vụ mạng xã hội là dịch vụ cho phép người dùng tạo trang cá nhân, đăng tải nội dung, tương tác đa chiều (theo dõi, kết bạn, bình luận, chia sẻ) và/hoặc lập nhóm/diễn đàn thảo luận; phải xin phép trước khi cung cấp.",
  "https://vbpl.vn/van-ban/trung-uong/nghi-dinh-27-2018-nd-cp",
);

const citationFor = (licenseType: string): LegalCitation => {
  if (licenseType === "online_game") return GAME_CITATION;
  if (licenseType === "electronic_press") return PRESS_CITATION;
  return SOCIAL_CITATION;
};

/**
 * Service-signal kinds that map to the four community/sharing behaviors in
 * Nghị định 27/2018/NĐ-CP (amending Nghị định 72/2013/NĐ-CP):
 *
 *   1. Tạo trang cá nhân (Profile):                public_profile
 *   2. Tự do đăng tải nội dung (Self-publish):     ugc
 *   3. Tương tác đa chiều (Interaction):          follow_or_friend, comment, share
 *   4. Tạo diễn đàn / Hội nhóm (Forum / Group):   content_feed
 *
 * The "login" signal is intentionally excluded — registration / sign-in
 * is an identity feature, not a community/sharing behavior, and is not
 * sufficient on its own to require a social-network license.
 */
const SOCIAL_NETWORK_BEHAVIORS: readonly ServiceSignalKind[] = [
  "public_profile",
  "ugc",
  "follow_or_friend",
  "comment",
  "share",
  "content_feed",
];

const SOCIAL_NETWORK_MIN_DISTINCT_KINDS = 2;

/**
 * Decide whether the observed service signals indicate the website is a
 * "mạng xã hội" (social network) per Nghị định 27/2018/NĐ-CP (amending
 * Nghị định 72/2013/NĐ-CP).
 *
 * Returns `true` when at least {@link SOCIAL_NETWORK_MIN_DISTINCT_KINDS}
 * distinct community/sharing behaviors are observed, otherwise `false`.
 *
 * Examples:
 *   [login]                                            → false
 *   [login, public_profile]                            → false
 *   [login, ugc]                                       → false
 *   [login, ugc, public_profile]                       → true  (criteria 1 + 2)
 *   [login, ugc, comment]                              → true  (criteria 2 + 3)
 *   [login, public_profile, follow_or_friend]          → true  (criteria 1 + 3)
 *   [login, content_feed, comment]                     → true  (criteria 3 + 4)
 */
export const hasSocialNetworkSignals = (signals: readonly ServiceSignal[]): boolean => {
  const observed = new Set(
    signals.filter((signal) => signal.observed).map((signal) => signal.kind),
  );
  let distinct = 0;
  for (const kind of SOCIAL_NETWORK_BEHAVIORS) {
    if (!observed.has(kind)) continue;
    distinct += 1;
    if (distinct >= SOCIAL_NETWORK_MIN_DISTINCT_KINDS) return true;
  }
  return false;
};

const statusFromRegistry = (
  licenseType: string,
  claims: readonly LicenseClaim[],
  registry: LicenseRegistryResult | undefined,
): LicenseCheck["status"] => {
  if (!registry) return claims.length > 0 ? "required_declared" : "required_unavailable";
  if (registry.licenseType !== licenseType) return "required_mismatch";
  if (registry.status === "verified") return "required_verified";
  if (registry.status === "not_found") return "required_not_found";
  if (registry.status === "mismatch") return "required_mismatch";
  if (registry.status === "expired") return "required_expired";
  return "required_unavailable";
};

const severityForStatus = (status: LicenseCheck["status"]): LicenseCheck["severity"] => {
  if (status === "not_required" || status === "required_verified") return "pass";
  return "high";
};

const rationaleFor = (
  licenseType: string,
  status: LicenseCheck["status"],
  claims: readonly LicenseClaim[],
  registry: LicenseRegistryResult | undefined,
): string => {
  const label =
    licenseType === "online_game"
      ? "giấy phép trò chơi điện tử"
      : licenseType === "electronic_press"
        ? "giấy phép báo chí điện tử"
        : "giấy phép mạng xã hội";
  if (status === "required_verified")
    return `Đã xác minh ${label} với nguồn registry được cấu hình.`;
  if (status === "required_declared") {
    return `Website có khai báo ${label} (${claims[0]?.value ?? "không rõ số giấy phép"}), nhưng chưa đối chiếu được nguồn chính thức.`;
  }
  if (status === "required_not_found")
    return `Không tìm thấy ${label} trong nguồn registry được cấu hình.`;
  if (status === "required_mismatch")
    return `Thông tin ${label} không khớp với loại giấy phép hoặc chủ thể được phát hiện.`;
  if (status === "required_expired")
    return `${label} được phát hiện nhưng nguồn registry cho biết đã hết hiệu lực.`;
  if (status === "required_unavailable") {
    if (licenseType === "social_network") {
      return `Phát hiện các tín hiệu cộng đồng (trang cá nhân, đăng tải nội dung, tương tác đa chiều, diễn đàn/hội nhóm) cho thấy dịch vụ thuộc phạm vi mạng xã hội theo Nghị định 27/2018/NĐ-CP sửa đổi Nghị định 72/2013/NĐ-CP; chưa đủ bằng chứng để xác minh ${label}, đây là tín hiệu rủi ro, không phải kết luận vi phạm.`;
    }
    return `Chưa có đủ bằng chứng để xác minh ${label}; đây là tín hiệu rủi ro, không phải kết luận vi phạm.`;
  }
  return registry?.rationale ?? `Chưa xác định yêu cầu về ${label}.`;
};

const makeCheck = (
  licenseType: string,
  claims: readonly LicenseClaim[],
  registry: LicenseRegistryResult | undefined,
): LicenseCheck => {
  const status = statusFromRegistry(licenseType, claims, registry);
  const legalCitation = citationFor(licenseType);
  return {
    id: `license::${licenseType}`,
    licenseType,
    status,
    severity: severityForStatus(status),
    rationale: rationaleFor(licenseType, status, claims, registry),
    confidence: registry ? 0.95 : claims.length > 0 ? 0.7 : 0.55,
    evidenceIds: claims.map((claim) => claim.evidenceId),
    citations: [legalCitation],
    recommendedAction:
      status === "required_verified"
        ? "Lưu hồ sơ xác minh và kiểm tra lại khi giấy phép thay đổi."
        : "Kiểm tra hồ sơ giấy phép, số đăng ký, chủ thể và thời hạn trước khi phát hành.",
    registrySourceUrl: registry?.sourceUrl ?? null,
    retrievedAt: registry?.retrievedAt ?? null,
  };
};

export const evaluateLicenseRequirements = (input: LicenseEvaluationInput): LicenseCheck[] => {
  if (input.jurisdiction !== "VN") return [];
  const checks: LicenseCheck[] = [];
  const claims = input.licenseClaims;
  const editorial =
    input.category === "electronic_press" ||
    input.signals.some((signal) => signal.observed && signal.kind === "editorial_publishing");
  if (input.category === "online_game")
    checks.push(makeCheck("online_game", claims, input.registry));
  if (editorial) checks.push(makeCheck("electronic_press", claims, input.registry));
  if (hasSocialNetworkSignals(input.signals))
    checks.push(makeCheck("social_network", claims, input.registry));
  return checks.map((check) => ({ ...check, rubricVersion: RUBRIC_VERSION }));
};
