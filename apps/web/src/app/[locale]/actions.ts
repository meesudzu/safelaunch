"use server";

import { createApiClient } from "../../lib/api-client";
import type {
  CreateScanInput,
  CreateScanResponse,
  ScanCachedResponse,
  ScanProgress,
} from "../../lib/api-client";

const apiClient = () =>
  createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

/**
 * Server action invoked by the homepage scan form.
 *
 * `process.env.NEXT_PUBLIC_API_ORIGIN` is populated at request time by the
 * OpenNext Cloudflare worker (it copies `env` from wrangler `vars` into
 * `process.env`). Keeping the API call on the server means the browser bundle
 * never has to inline `NEXT_PUBLIC_API_ORIGIN` at build time.
 *
 * Returns either a fresh-scan response (202) or a cached response (200) when
 * the daily-domain-quota feature is enabled and the domain has already been
 * scanned today. The form discriminates via the `cached` flag.
 */
export async function createScan(
  input: CreateScanInput,
): Promise<CreateScanResponse | ScanCachedResponse> {
  return apiClient().createScan(input);
}

/** Server action used by the scan progress screen for initial load and polling. */
export async function getScan(scanId: string): Promise<ScanProgress> {
  return apiClient().getScan(scanId);
}
