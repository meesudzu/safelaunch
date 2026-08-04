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
  evidenceExcerpt: string;
  upcomingEffectiveAt: string | null;
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
      const response = await fetch(
        `${requireOrigin(base)}/v1/reports/${encodeURIComponent(token)}?token=${encodeURIComponent(token)}`,
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
