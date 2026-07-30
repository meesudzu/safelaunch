/**
 * Privacy-preserving observability helpers.
 *
 * Every event that leaves the Worker is shaped through `toLogEvent`. The
 * helper guarantees:
 *  - the original URL path, the raw request body, and any report token
 *    are NEVER written;
 *  - the host becomes a deterministic salted hash so dashboards can count
 *    events per origin without ever storing the origin itself;
 *  - the client IP becomes a separate salted hash for the same reason;
 *  - the event name and timestamp are always present.
 *
 * Salt rotation lives in `hashOpaque`: the test suite can inject a fixed
 * salt via `hashOpaque` for stable hashes; production uses a per-process
 * random salt.
 */

const DEFAULT_SALT_BYTES = 16;

const toHex = (bytes: Uint8Array): string => {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
};

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
};

let activeSalt: string | null = null;
const getSalt = (): string => {
  if (activeSalt) return activeSalt;
  const bytes = new Uint8Array(DEFAULT_SALT_BYTES);
  crypto.getRandomValues(bytes);
  activeSalt = toHex(bytes);
  return activeSalt;
};

export const hashOpaque = async (
  value: string,
  salt: string = getSalt(),
): Promise<string> => {
  return sha256Hex(`${salt}::${value}`).then((hex) => hex.slice(0, 16));
};

export interface LogRequest {
  readonly method: string;
  readonly url: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly body?: unknown;
}

export interface LogEvent extends Record<string, unknown> {
  readonly event: string;
  readonly at: string;
  readonly hostHash: string;
  readonly ipHash: string;
  readonly method: string;
  readonly userAgentHash: string;
  readonly path?: never;
  readonly url?: never;
  readonly token?: never;
  readonly body?: never;
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
};

export const toLogEvent = async (
  request: LogRequest,
  overrides: Partial<LogEvent> & { now?: string } = {},
): Promise<LogEvent> => {
  const host = safeHost(request.url);
  const [hostHash, ipHash, userAgentHash] = await Promise.all([
    hashOpaque(host),
    hashOpaque(request.ip),
    hashOpaque(request.userAgent),
  ]);
  const base = {
    event: overrides.event ?? "request",
    at: overrides.now ?? overrides.at ?? new Date().toISOString(),
    hostHash,
    ipHash,
    method: request.method,
    userAgentHash,
  };
  return { ...base, ...overrides };
};
