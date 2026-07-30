/**
 * Typed wrapper around POST /v1/scans.
 *
 * The public API origin must be configured via the validated
 * `NEXT_PUBLIC_API_ORIGIN` environment variable at build time. Anything else
 * throws at construction so a misconfigured deployment fails fast.
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
}

export interface CreateScanResponse {
  scanId: string;
  state: "queued";
}

const trimTrailingSlash = (origin: string): string =>
  origin.endsWith("/") ? origin.slice(0, -1) : origin;

export interface ApiClientEnv {
  readonly NEXT_PUBLIC_API_ORIGIN?: string | undefined;
}

export const createApiClient = (env: Partial<ApiClientEnv> = {}) => {
  const origin = env.NEXT_PUBLIC_API_ORIGIN;
  const base = origin ? trimTrailingSlash(origin) : null;
  return {
    createScan: async (input: CreateScanInput): Promise<CreateScanResponse> => {
      const response = await fetch(`${base}/v1/scans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ApiClientError(
          response.status,
          "CREATE_SCAN_FAILED",
          `API returned ${response.status}: ${text || "(no body)"}`,
        );
      }
      return (await response.json()) as CreateScanResponse;
    },
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
