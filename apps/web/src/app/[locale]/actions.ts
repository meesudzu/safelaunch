"use server";

import { createApiClient } from "../../lib/api-client";
import type {
  CreateScanInput,
  CreateScanResponse,
  ScanCachedResponse,
} from "../../lib/api-client";

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
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });
  return client.createScan(input);
}
