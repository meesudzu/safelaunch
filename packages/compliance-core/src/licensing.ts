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
  validFrom?: string;
  validTo?: string;
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

const CITATION_RETRIEVED_AT = "2026-08-04T00:00:00.000Z";

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
  "https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=18370",
);

const PRESS_CITATION = citation(
  "vn-press-license-review",
  "Luật Báo chí 2016 — nguồn chính thức cần đối chiếu điều khoản áp dụng",
  "Cần đối chiếu loại hình và giấy phép của dịch vụ báo chí điện tử với văn bản chính thức trước khi kết luận.",
);

const SOCIAL_CITATION = citation(
  "vn-social-license-review",
  "Quy định Việt Nam về cung cấp và quản lý thông tin trên mạng — nguồn chính thức cần đối chiếu điều khoản áp dụng",
  "Cần đối chiếu các dấu hiệu cung cấp mạng xã hội và giấy phép tương ứng với văn bản chính thức trước khi kết luận.",
);

const citationFor = (licenseType: string): LegalCitation => {
  if (licenseType === "online_game") return GAME_CITATION;
  if (licenseType === "electronic_press") return PRESS_CITATION;
  return SOCIAL_CITATION;
};

const socialInteractionKinds: readonly ServiceSignalKind[] = [
  "public_profile",
  "content_feed",
  "follow_or_friend",
  "comment",
  "share",
];

export const hasSocialNetworkSignals = (signals: readonly ServiceSignal[]): boolean => {
  const hasUgc = signals.some((signal) => signal.observed && signal.kind === "ugc");
  const hasInteraction = signals.some(
    (signal) => signal.observed && socialInteractionKinds.includes(signal.kind),
  );
  return hasUgc && hasInteraction;
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
  if (status === "required_unavailable")
    return `Chưa có đủ bằng chứng để xác minh ${label}; đây là tín hiệu rủi ro, không phải kết luận vi phạm.`;
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
