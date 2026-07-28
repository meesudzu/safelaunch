export class UnsafeUrlError extends Error {
  constructor(
    readonly source: string,
    readonly reason: string,
  ) {
    super(`URL ${source} is unsafe: ${reason}`);
    this.name = "UnsafeUrlError";
  }
}

export interface DnsResolve {
  (hostname: string): Promise<readonly string[]>;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const HOSTNAME_REGEX =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

const ipOctets = (value: string): readonly number[] =>
  value.split(".").map((octet) => Number.parseInt(octet, 10));

const octet = (octets: readonly number[], index: number): number => octets[index] ?? 0;

const isLoopbackAddress = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    return true;
  }
  if (IPV4_REGEX.test(lower)) {
    const octets = ipOctets(lower);
    const o0 = octet(octets, 0);
    const o1 = octet(octets, 1);
    if (o0 === 127) return true;
    if (o0 === 0) return true;
    if (o0 === 169 && o1 === 254) return true;
    if (o0 === 10) return true;
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
    if (o0 === 192 && o1 === 168) return true;
    if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;
    if (o0 === 198 && (o1 === 18 || o1 === 19)) return true;
    if (o0 >= 240) return true;
  }
  if (lower === "::1" || lower === "::" || lower.startsWith("fe80:")) {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  return false;
};

const isUnregisteredAddress = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  return (
    lower === "0.0.0.0" ||
    lower === "255.255.255.255" ||
    lower === "0" ||
    lower === "::" ||
    lower === "::1"
  );
};

export interface ValidatedUrl {
  url: URL;
  addresses: readonly string[];
}

export const validatePublicUrl = async (
  raw: string,
  resolve: DnsResolve,
): Promise<ValidatedUrl> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new UnsafeUrlError(raw, `parse failed (${(cause as Error).message})`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(raw, `protocol ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError(raw, "credentials are not allowed");
  }
  const hostname = url.hostname.trim();
  if (!hostname) {
    throw new UnsafeUrlError(raw, "missing hostname");
  }
  if (!HOSTNAME_REGEX.test(hostname) && !IPV4_REGEX.test(hostname) && !hostname.includes(":")) {
    throw new UnsafeUrlError(raw, `hostname ${hostname} is malformed`);
  }
  if (isLoopbackAddress(hostname) || isUnregisteredAddress(hostname)) {
    throw new UnsafeUrlError(raw, `hostname ${hostname} resolves to a private address`);
  }
  let addresses: readonly string[];
  try {
    addresses = await resolve(hostname);
  } catch (cause) {
    throw new UnsafeUrlError(raw, `dns lookup failed (${(cause as Error).message})`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(raw, `hostname ${hostname} has no dns records`);
  }
  for (const address of addresses) {
    if (isLoopbackAddress(address) || isUnregisteredAddress(address)) {
      throw new UnsafeUrlError(raw, `hostname ${hostname} resolves to blocked address ${address}`);
    }
  }
  return { url, addresses };
};
