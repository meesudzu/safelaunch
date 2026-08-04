import type { DnsResolve } from "./url-policy";

/**
 * Resolves a hostname's A/AAAA records via Cloudflare's DNS-over-HTTPS
 * JSON API. Workers has no native DNS API, so this is how `validatePublicUrl`
 * gets real addresses to check against the private/loopback blocklist.
 */
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const TYPE_A = 1;
const TYPE_AAAA = 28;

interface DohAnswer {
  readonly type: number;
  readonly data: string;
}

interface DohResponse {
  readonly Answer?: readonly DohAnswer[];
}

const queryRecordType = async (
  hostname: string,
  type: number,
  fetchImpl: typeof fetch,
): Promise<readonly string[]> => {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`;
  const response = await fetchImpl(url, { headers: { accept: "application/dns-json" } });
  if (!response.ok) {
    throw new Error(`DoH query failed with status ${response.status}`);
  }
  const body = (await response.json()) as unknown as DohResponse;
  return (body.Answer ?? []).filter((answer) => answer.type === type).map((answer) => answer.data);
};

export const createDohResolver = (fetchImpl: typeof fetch = fetch): DnsResolve => {
  return async (hostname: string): Promise<readonly string[]> => {
    const results = await Promise.allSettled([
      queryRecordType(hostname, TYPE_A, fetchImpl),
      queryRecordType(hostname, TYPE_AAAA, fetchImpl),
    ]);
    const addresses: string[] = [];
    let anySucceeded = false;
    for (const result of results) {
      if (result.status === "fulfilled") {
        anySucceeded = true;
        addresses.push(...result.value);
      }
    }
    if (!anySucceeded) {
      const reasons = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        )
        .join("; ");
      throw new Error(`DNS-over-HTTPS lookup failed for ${hostname}: ${reasons}`);
    }
    return addresses;
  };
};

export const resolveViaDoH: DnsResolve = createDohResolver();
