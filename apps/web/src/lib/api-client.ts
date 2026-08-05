import type {
  AssetLicenseEvidence,
  DigitalAssetKind,
  LicenseCheckStatus,
  ServiceSignalKind,
} from "@safelaunch/contracts";
/**
 * Typed wrapper around the public SafeLaunch API.
 *
 * Every endpoint requires `NEXT_PUBLIC_API_ORIGIN` at build time; the
 * constructors defer the failure to the first network call so the
 * production build doesn't fail in CI environments that haven't set the
 * origin yet.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface CreateScanInput {
  url: string;
  jurisdiction: "VN";
  category: "online_game" | "electronic_press" | "digital_entertainment";
  redeemCode?: string; // SL-XXXX-XXXX
}

export interface ScanCachedResponse {
  scanId: string;
  state: "completed" | "partial" | "failed";
  status?: "high_risk" | "needs_review" | "no_significant_risk";
  coverage: { fetched: string[]; failed: string[]; skipped: string[] };
  createdAt: string;
  expiresAt: string;
  reportUrl: string | null;
  cached: true;
  quotaDay: string;
  domainKey: string;
  message: string;
}

export interface CreateScanResponse {
  scanId: string;
  state: "queued";
}

export interface ScanProgress {
  scanId: string;
  state: string;
  status?: string;
  coverage: { fetched: string[]; failed: string[]; skipped: string[] };
  expiresAt?: string;
  reportUrl?: string;
}

export interface ReportServiceSignalDto {
  id: string;
  kind: ServiceSignalKind;
  observed: boolean;
  confidence: number;
  sourceUrl: string;
  excerpt: string;
  evidenceId: string;
}

export interface ReportLicenseCheckDto {
  id: string;
  licenseType: string;
  status: LicenseCheckStatus;
  severity: "high" | "review" | "pass";
  rationale: string;
  confidence: number;
  evidenceIds: string[];
  citations: Array<{
    provisionId: string;
    source: string;
    url: string;
    retrievedAt: string;
    excerpt: string;
  }>;
  recommendedAction: string;
  registrySourceUrl?: string | null;
  retrievedAt?: string | null;
}

export interface ReportDigitalAssetDto {
  id: string;
  kind: DigitalAssetKind;
  url: string;
  host: string;
  sourceUrl: string;
  contentType: string | null;
  sha256: string | null;
  status: "fetched" | "inaccessible" | "blocked";
  licenseEvidence: AssetLicenseEvidence;
  licenseExcerpt: string | null;
  confidence: number;
}

export interface ReportFindingDto {
  id: string;
  severity: "high" | "review" | "pass";
  rationale: string;
  confidence: number;
  evidenceIds: string[];
  citations: Array<{
    provisionId: string;
    source: string;
    url: string;
    retrievedAt: string;
    excerpt: string;
  }>;
  recommendedAction: string;
  applicability: "current" | "upcoming";
  evidenceExcerpt?: string;
  upcomingEffectiveAt?: string | null;
  domain?: "regulatory" | "license" | "digital-rights";
}

export interface ReportPayloadDto {
  scanId: string;
  jurisdiction: string;
  category: "online_game" | "electronic_press" | "digital_entertainment";
  status: "high_risk" | "needs_review" | "no_significant_risk";
  coverage: { fetched: string[]; failed: string[]; skipped: string[] };
  findings: readonly ReportFindingDto[];
  generatedAt: string;
  expiresAt: string;
  rubricVersion: string;
  serviceSignals?: readonly ReportServiceSignalDto[];
  licenseChecks?: readonly ReportLicenseCheckDto[];
  assetInventory?: {
    assets: readonly ReportDigitalAssetDto[];
    summary: { total: number; byKind: Record<string, number>; flagged: number };
  };
}

export interface PendingDocumentSummary {
  id: string;
  jurisdiction: string;
  sourceUrl: string;
  title: string;
  retrievedAt: string;
}

export interface PendingLegalDocumentDto {
  id: string;
  jurisdiction: string;
  sourceUrl: string;
  title: string;
  retrievedAt: string;
  sourceHash: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  provisions: Array<{
    id: string;
    article: string;
    clause: string | null;
    text: string;
    categories: string[];
  }>;
  relations: Array<{
    id: string;
    type: string;
    targetDocumentId: string;
  }>;
  audit: Array<{
    actor: string;
    decision: string;
    reason: string;
    createdAt: string;
  }>;
}

export interface ReviewSubmissionDto {
  decision: "approve" | "reject";
  reason: string;
}

export interface AdminAuditEventDto {
  id: string;
  documentId: string;
  actor: string;
  decision: "approved" | "rejected" | "pending";
  reason: string;
  createdAt: string;
  documentTitle: string | null;
  jurisdiction: string | null;
}

export interface AdminAuditPageDto {
  items: AdminAuditEventDto[];
  nextCursor: string | null;
  window: { from: string; to: string | null };
}

export interface AdminAuditFilters {
  from?: string;
  to?: string;
  actor?: string;
  decision?: AdminAuditEventDto["decision"];
  cursor?: string;
}

export interface AdminUsageMetricsDto {
  window: { from: string; to: string; previousFrom: string };
  scans: { value: number; previous: number; delta: number };
  uniqueSites: { value: number; previous: number; delta: number };
  reportsOpened: { value: number; previous: number; delta: number };
  activeReviewers: { value: number; previous: number; delta: number };
  uniqueSitesComplete: boolean;
}
export interface AdminHealthDto {
  checkedAt: string;
  sections: Record<
    string,
    {
      status: "available" | "degraded" | "unknown";
      checkedAt: string;
      reason?: string;
      metrics?: Record<string, number | string | null>;
    }
  >;
}
export interface AdminComplianceMetricsDto {
  window: { from: string; to: string };
  severityOrder: readonly ["pass", "review", "high"];
  totals: Record<"pass" | "review" | "high", number>;
  categories: Array<{
    category: string;
    counts: Record<"pass" | "review" | "high", number>;
    total: number;
    medianSeverity: "pass" | "review" | "high" | null;
  }>;
  version: { rule_version_id: string; prompt_version: string; retrieval_version: string } | null;
}
export interface AdminScanSummaryDto {
  id: string;
  urlHash: string | null;
  jurisdiction: string;
  category: string;
  state: string;
  createdAt: string;
  expiresAt: string;
  pagesDone: number;
  pagesTotal: number;
}
export interface AdminScanListDto {
  items: AdminScanSummaryDto[];
  nextCursor: string | null;
  window: { from: string; to: string | null };
}
export interface AdminScanDetailDto extends Omit<AdminScanSummaryDto, "pagesDone" | "pagesTotal"> {
  coverage: Record<"fetched" | "failed" | "skipped", number>;
  analysisVersion: string;
  pageStates: Array<{ state: string; count: number }>;
  findingSeverities: Array<{ severity: string; count: number }>;
  analysisRuns: Array<{
    model_id: string;
    prompt_version: string;
    retrieval_version: string;
    rule_version_id: string;
    created_at: string;
  }>;
  report: { available: boolean; expiresAt: string } | null;
}

export interface ApiClientEnv {
  readonly NEXT_PUBLIC_API_ORIGIN?: string | undefined;
}

const trimTrailingSlash = (origin: string): string =>
  origin.endsWith("/") ? origin.slice(0, -1) : origin;

const requireOrigin = (base: string | null): string => {
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_ORIGIN is not configured; the web app cannot reach the API");
  }
  return base;
};

const toApiClientError = async (response: Response, code: string): Promise<ApiClientError> => {
  const text = await response.text().catch(() => "");
  return new ApiClientError(
    response.status,
    code,
    `API returned ${response.status}: ${text || "(no body)"}`,
  );
};

export const createApiClient = (env: Partial<ApiClientEnv> = {}) => {
  const base = env.NEXT_PUBLIC_API_ORIGIN ? trimTrailingSlash(env.NEXT_PUBLIC_API_ORIGIN) : null;
  return {
    createScan: async (
      input: CreateScanInput,
    ): Promise<CreateScanResponse | ScanCachedResponse> => {
      const response = await fetch(`${requireOrigin(base)}/v1/scans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(input),
      });
      if (response.status === 200) {
        return (await response.json()) as ScanCachedResponse;
      }
      if (response.status === 202) {
        return (await response.json()) as CreateScanResponse;
      }
      throw await toApiClientError(response, "CREATE_SCAN_FAILED");
    },
    getScan: async (scanId: string): Promise<ScanProgress> => {
      const response = await fetch(
        `${requireOrigin(base)}/v1/scans/${encodeURIComponent(scanId)}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw await toApiClientError(response, "GET_SCAN_FAILED");
      }
      return (await response.json()) as ScanProgress;
    },
    getReport: async (token: string): Promise<ReportPayloadDto> => {
      // The public report URL only contains the one-time token (no scanId
      // is ever exposed to the client), so we call the by-token endpoint
      // which looks the row up by SHA-256(token_hash) directly.
      const response = await fetch(
        `${requireOrigin(base)}/v1/reports/by-token/${encodeURIComponent(token)}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw await toApiClientError(response, "GET_REPORT_FAILED");
      }
      return (await response.json()) as ReportPayloadDto;
    },
    listPendingDocuments: async (): Promise<PendingDocumentSummary[]> => {
      const response = await fetch(`${requireOrigin(base)}/v1/admin/legal/pending`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        throw await toApiClientError(response, "LIST_PENDING_FAILED");
      }
      return (await response.json()) as PendingDocumentSummary[];
    },
    listAdminAudit: async (filters: AdminAuditFilters = {}): Promise<AdminAuditPageDto> => {
      const params = new URLSearchParams();
      const entries: Array<[keyof AdminAuditFilters, string | undefined]> = [
        ["from", filters.from],
        ["to", filters.to],
        ["actor", filters.actor],
        ["decision", filters.decision],
        ["cursor", filters.cursor],
      ];
      for (const [key, value] of entries) {
        if (value) params.set(key, value);
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const response = await fetch(`${requireOrigin(base)}/v1/admin/audit${suffix}`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        throw await toApiClientError(response, "LIST_ADMIN_AUDIT_FAILED");
      }
      return (await response.json()) as AdminAuditPageDto;
    },
    getAdminUsageMetrics: async (): Promise<AdminUsageMetricsDto> => {
      const response = await fetch(`${requireOrigin(base)}/v1/admin/metrics/usage`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw await toApiClientError(response, "GET_ADMIN_USAGE_METRICS_FAILED");
      return (await response.json()) as AdminUsageMetricsDto;
    },
    getAdminComplianceMetrics: async (): Promise<AdminComplianceMetricsDto> => {
      const response = await fetch(`${requireOrigin(base)}/v1/admin/metrics/compliance`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok)
        throw await toApiClientError(response, "GET_ADMIN_COMPLIANCE_METRICS_FAILED");
      return (await response.json()) as AdminComplianceMetricsDto;
    },
    listAdminScans: async (
      filters: Record<string, string | undefined> = {},
    ): Promise<AdminScanListDto> => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await fetch(
        `${requireOrigin(base)}/v1/admin/scans${params.size ? `?${params}` : ""}`,
        { headers: { accept: "application/json" }, credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw await toApiClientError(response, "LIST_ADMIN_SCANS_FAILED");
      return (await response.json()) as AdminScanListDto;
    },
    getAdminScan: async (scanId: string): Promise<AdminScanDetailDto | null> => {
      const response = await fetch(
        `${requireOrigin(base)}/v1/admin/scans/${encodeURIComponent(scanId)}`,
        { headers: { accept: "application/json" }, credentials: "include", cache: "no-store" },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw await toApiClientError(response, "GET_ADMIN_SCAN_FAILED");
      return (await response.json()) as AdminScanDetailDto;
    },
    getAdminHealth: async (): Promise<AdminHealthDto> => {
      const response = await fetch(`${requireOrigin(base)}/v1/admin/health`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw await toApiClientError(response, "GET_ADMIN_HEALTH_FAILED");
      return (await response.json()) as AdminHealthDto;
    },
    getPendingDocument: async (documentId: string): Promise<PendingLegalDocumentDto | null> => {
      const response = await fetch(
        `${requireOrigin(base)}/v1/admin/legal/${encodeURIComponent(documentId)}`,
        {
          headers: { accept: "application/json" },
          credentials: "include",
        },
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await toApiClientError(response, "GET_PENDING_FAILED");
      }
      return (await response.json()) as PendingLegalDocumentDto;
    },
    submitReview: async (documentId: string, submission: ReviewSubmissionDto): Promise<void> => {
      const response = await fetch(
        `${requireOrigin(base)}/v1/admin/legal/${encodeURIComponent(documentId)}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          credentials: "include",
          body: JSON.stringify(submission),
        },
      );
      if (!response.ok) {
        throw await toApiClientError(response, "SUBMIT_REVIEW_FAILED");
      }
    },
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
