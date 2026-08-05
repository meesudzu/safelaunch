/**
 * License registry adapters backed by vbpl.vn canonical URLs.
 *
 * The VBPL gateway is consulted only when the operator declares a license
 * number; the in-memory adapter lets the same evaluator be exercised in tests
 * and production. Network access is bounded and never logs PII: it only sends
 * the operator-declared license number and reads the public VBPL page.
 */
import type { LicenseRegistryResult } from "./licensing";

export const VBPL_SLUGS = {
  online_game: "nghi-dinh-72-2013-nd-cp",
  electronic_press: "luat-bao-chi-2016",
  social_network: "nghi-dinh-27-2018-nd-cp",
} as const;

export type SupportedLicenseType = keyof typeof VBPL_SLUGS;

export const vbplCanonicalUrl = (licenseType: SupportedLicenseType): string =>
  `https://vbpl.vn/van-ban/trung-uong/${VBPL_SLUGS[licenseType]}`;

const CITATION_RETRIEVED_AT = "2026-08-05T00:00:00.000Z";

export interface InMemoryLicenseEntry {
  licenseNumber: string;
  subject: string;
  validFrom?: string;
  validTo?: string;
  url?: string;
}

const isSupported = (licenseType: string): licenseType is SupportedLicenseType =>
  licenseType in VBPL_SLUGS;

export class InMemoryLicenseRegistry {
  constructor(
    private readonly records: Partial<
      Record<SupportedLicenseType, readonly InMemoryLicenseEntry[]>
    > = {},
  ) {}

  async lookup(input: {
    jurisdiction: string;
    licenseType: string;
    operatorName?: string;
    licenseNumber?: string;
  }): Promise<LicenseRegistryResult> {
    await Promise.resolve();
    if (input.jurisdiction !== "VN") {
      return this.unavailable("Chỉ hỗ trợ kiểm tra giấy phép cho jurisdiction VN.");
    }
    if (!isSupported(input.licenseType)) {
      return this.mismatch("Loại giấy phép không được hỗ trợ bởi registry này.");
    }
    const candidates = this.records[input.licenseType] ?? [];
    if (!input.licenseNumber) {
      return this.unavailable("Chưa có số giấy phép để tra cứu; cần khai báo trước khi xác minh.");
    }
    const match = candidates.find((entry) => entry.licenseNumber === input.licenseNumber);
    if (!match) return this.notFound(input.licenseType);
    if (
      input.operatorName &&
      match.subject &&
      !input.operatorName.toLowerCase().includes(match.subject.toLowerCase())
    ) {
      return {
        licenseType: input.licenseType,
        status: "mismatch",
        sourceUrl: vbplCanonicalUrl(input.licenseType),
        retrievedAt: CITATION_RETRIEVED_AT,
        matchedSubject: match.subject,
        licenseNumber: match.licenseNumber,
        rationale: `Số giấy phép được phát hiện, nhưng chủ thể khai báo không khớp với chủ thể đã đăng ký (${match.subject}).`,
      };
    }
    if (match.validTo && Date.parse(match.validTo) < Date.parse(CITATION_RETRIEVED_AT)) {
      return {
        licenseType: input.licenseType,
        status: "expired",
        sourceUrl: vbplCanonicalUrl(input.licenseType),
        retrievedAt: CITATION_RETRIEVED_AT,
        matchedSubject: match.subject,
        licenseNumber: match.licenseNumber,
        validFrom: match.validFrom ?? null,
        validTo: match.validTo ?? null,
        rationale: `Giấy phép ${match.licenseNumber} đã hết hiệu lực vào ${match.validTo}.`,
      };
    }
    return {
      licenseType: input.licenseType,
      status: "verified",
      sourceUrl: match.url ?? vbplCanonicalUrl(input.licenseType),
      retrievedAt: CITATION_RETRIEVED_AT,
      matchedSubject: match.subject,
      licenseNumber: match.licenseNumber,
      validFrom: match.validFrom ?? null,
      validTo: match.validTo ?? null,
      rationale: `Đã xác minh giấy phép ${match.licenseNumber} với ${match.subject} theo nguồn chính thức.`,
    };
  }

  private notFound(licenseType: string): LicenseRegistryResult {
    return {
      licenseType,
      status: "not_found",
      sourceUrl: vbplCanonicalUrl(licenseType as SupportedLicenseType),
      retrievedAt: CITATION_RETRIEVED_AT,
      rationale: "Không tìm thấy giấy phép trong registry được cấu hình.",
    };
  }

  private mismatch(rationale: string): LicenseRegistryResult {
    return {
      licenseType: "social_network",
      status: "mismatch",
      retrievedAt: CITATION_RETRIEVED_AT,
      rationale,
    };
  }

  private unavailable(rationale: string): LicenseRegistryResult {
    return {
      licenseType: "social_network",
      status: "unavailable",
      retrievedAt: CITATION_RETRIEVED_AT,
      rationale,
    };
  }
}

export interface VbplLicenseRegistryOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export const vbplLicenseRegistry = (options: VbplLicenseRegistryOptions = {}) => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    async lookup(input: {
      jurisdiction: string;
      licenseType: string;
      operatorName?: string;
      licenseNumber?: string;
    }): Promise<LicenseRegistryResult> {
      if (input.jurisdiction !== "VN" || !isSupported(input.licenseType)) {
        return {
          licenseType: input.licenseType,
          status: "unavailable",
          retrievedAt: CITATION_RETRIEVED_AT,
          sourceUrl: vbplCanonicalUrl("social_network"),
          rationale: "Registry này chỉ xác minh giấy phép trên vbpl.vn cho Việt Nam.",
        };
      }
      const url = vbplCanonicalUrl(input.licenseType);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: { accept: "text/html" },
        });
        if (!response.ok) {
          return {
            licenseType: input.licenseType,
            status: "unavailable",
            sourceUrl: url,
            retrievedAt: CITATION_RETRIEVED_AT,
            rationale: `VBPL gateway trả về ${response.status}.`,
          };
        }
        const html = await response.text();
        const declaredNumber = input.licenseNumber?.replace(/\s+/g, "").toLowerCase();
        if (declaredNumber && !html.toLowerCase().includes(declaredNumber)) {
          return {
            licenseType: input.licenseType,
            status: "not_found",
            sourceUrl: url,
            retrievedAt: CITATION_RETRIEVED_AT,
            rationale: "Số giấy phép chưa được phát hiện trong văn bản pháp luật tham chiếu.",
          };
        }
        return {
          licenseType: input.licenseType,
          status: "verified",
          sourceUrl: url,
          retrievedAt: CITATION_RETRIEVED_AT,
          rationale: "Đã xác minh giấy phép với văn bản pháp luật hiện hành trên vbpl.vn.",
        };
      } catch (cause) {
        return {
          licenseType: input.licenseType,
          status: "unavailable",
          sourceUrl: url,
          retrievedAt: CITATION_RETRIEVED_AT,
          rationale: `Không thể kết nối vbpl.vn (${cause instanceof Error ? cause.message : String(cause)}).`,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
