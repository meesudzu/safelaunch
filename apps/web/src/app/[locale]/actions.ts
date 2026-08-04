"use server";

import { createApiClient } from "../../lib/api-client";
import type { CreateScanInput, CreateScanResponse } from "../../lib/api-client";

/**
 * Server action invoked by the homepage scan form.
 *
 * `process.env.NEXT_PUBLIC_API_ORIGIN` is populated at request time by the
 * OpenNext Cloudflare worker (it copies `env` from wrangler `vars` into
 * `process.env`). Keeping the API call on the server means the browser bundle
 * never has to inline `NEXT_PUBLIC_API_ORIGIN` at build time.
 */
export async function createScan(input: CreateScanInput): Promise<CreateScanResponse> {
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });
  return client.createScan(input);
}
