import { validatePublicUrl, UnsafeUrlError, type DnsResolve } from "./url-policy";

export interface FetchLimits {
  readonly redirects: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly durationMs: number;
  readonly connectMs: number;
  readonly accept: readonly string[];
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  redirects: 3,
  compressedBytes: 1_000_000,
  decodedBytes: 2_000_000,
  durationMs: 8_000,
  connectMs: 3_000,
  accept: ["text/html", "application/xhtml+xml"],
};

export interface FetchRequest {
  url: string;
  resolve: DnsResolve;
  fetchImpl?: typeof fetch;
  limits?: FetchLimits;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
}

export class FetchLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchLimitError";
  }
}

const isHtmlContentType = (value: string | null): boolean => {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.includes("text/html") || lower.includes("application/xhtml+xml");
};

const mergeAbort = (timeoutMs: number): AbortSignal => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const original = controller.signal;
  original.addEventListener("abort", () => clearTimeout(timer));
  return original;
};

const validateOrThrow = async (rawUrl: string, resolve: DnsResolve) => {
  try {
    return await validatePublicUrl(rawUrl, resolve);
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) throw cause;
    throw new UnsafeUrlError(rawUrl, cause instanceof Error ? cause.message : String(cause));
  }
};

export const fetchBoundedHtml = async (request: FetchRequest): Promise<FetchResult> => {
  const limits = { ...DEFAULT_FETCH_LIMITS, ...(request.limits ?? {}) };
  const fetchImpl = request.fetchImpl ?? fetch;
  const validated = await validateOrThrow(request.url, request.resolve);
  const initialAddress = validated.addresses[0];
  if (!initialAddress) {
    throw new UnsafeUrlError(request.url, "no addresses available");
  }
  let currentUrl = validated.url.toString();
  let currentAddress = initialAddress;
  for (let redirect = 0; redirect <= limits.redirects; redirect += 1) {
    const signal = mergeAbort(limits.durationMs);
    const start = Date.now();
    // Keep the validated hostname in the request URL. Fetching the resolved
    // IP directly breaks TLS SNI and virtual-host routing for HTTPS sites;
    // resolution is used by the URL policy as an SSRF guard, not as a dial
    // target override.
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "SafeLaunchBot/1.0 (+https://safelaunch.app/bot)",
        accept: limits.accept.join(", "),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new FetchLimitError(`redirect ${response.status} without location header`);
      }
      const next = new URL(location, currentUrl);
      const nextValidated = await validateOrThrow(next.toString(), request.resolve);
      currentAddress = nextValidated.addresses[0] ?? currentAddress;
      currentUrl = nextValidated.url.toString();
      continue;
    }
    if (!response.ok) {
      throw new FetchLimitError(`unexpected status ${response.status} from ${currentUrl}`);
    }
    const contentType = response.headers.get("content-type");
    if (!isHtmlContentType(contentType)) {
      throw new FetchLimitError(
        `unsupported content type ${contentType ?? "<none>"} from ${currentUrl}`,
      );
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const total = Number.parseInt(contentLength, 10);
      if (Number.isFinite(total) && total > limits.compressedBytes) {
        throw new FetchLimitError(
          `response body ${total} bytes exceeds compressed limit ${limits.compressedBytes}`,
        );
      }
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new FetchLimitError(`response body is not a readable stream for ${currentUrl}`);
    }
    const chunks: Uint8Array[] = [];
    let compressed = 0;
    let decoded = 0;
    while (true) {
      const readResult = (await reader.read()) as { value: Uint8Array | undefined; done: boolean };
      if (readResult.done) break;
      const value = readResult.value;
      if (!value) continue;
      compressed += value.byteLength;
      if (compressed > limits.compressedBytes) {
        await reader.cancel();
        throw new FetchLimitError(`compressed payload exceeded ${limits.compressedBytes} bytes`);
      }
      decoded += value.byteLength;
      if (decoded > limits.decodedBytes) {
        await reader.cancel();
        throw new FetchLimitError(`decoded payload exceeded ${limits.decodedBytes} bytes`);
      }
      chunks.push(value);
    }
    if (Date.now() - start > limits.durationMs) {
      throw new FetchLimitError(`request took longer than ${limits.durationMs}ms`);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      url: request.url,
      finalUrl: currentUrl,
      status: response.status,
      contentType,
      bytes,
    };
  }
  throw new FetchLimitError(`exceeded redirect limit ${limits.redirects}`);
};

/** Fetches a referenced binary/text asset with the same public-URL and
 * redirect protections as page fetches, without retaining the original. */
export const fetchBoundedResource = async (request: FetchRequest): Promise<FetchResult> => {
  const limits = {
    ...DEFAULT_FETCH_LIMITS,
    compressedBytes: 2_000_000,
    decodedBytes: 2_000_000,
    accept: ["*/*"],
    ...(request.limits ?? {}),
  };
  const fetchImpl = request.fetchImpl ?? fetch;
  const validated = await validateOrThrow(request.url, request.resolve);
  let currentUrl = validated.url.toString();
  for (let redirect = 0; redirect <= limits.redirects; redirect += 1) {
    const signal = mergeAbort(limits.durationMs);
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "SafeLaunchBot/1.0 (+https://safelaunch.app/bot)",
        accept: limits.accept.join(", "),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location)
        throw new FetchLimitError(`redirect ${response.status} without location header`);
      const next = new URL(location, currentUrl);
      const nextValidated = await validateOrThrow(next.toString(), request.resolve);
      currentUrl = nextValidated.url.toString();
      continue;
    }
    if (!response.ok)
      throw new FetchLimitError(`unexpected status ${response.status} from ${currentUrl}`);
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const total = Number.parseInt(contentLength, 10);
      if (Number.isFinite(total) && total > limits.compressedBytes) {
        throw new FetchLimitError(
          `response body exceeds compressed limit ${limits.compressedBytes}`,
        );
      }
    }
    const reader = response.body?.getReader();
    if (!reader) throw new FetchLimitError(`response body is not readable for ${currentUrl}`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const readResult = (await reader.read()) as { value: Uint8Array | undefined; done: boolean };
      if (readResult.done) break;
      if (!readResult.value) continue;
      total += readResult.value.byteLength;
      if (total > limits.decodedBytes) {
        await reader.cancel();
        throw new FetchLimitError(`decoded payload exceeded ${limits.decodedBytes} bytes`);
      }
      chunks.push(readResult.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      url: request.url,
      finalUrl: currentUrl,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes,
    };
  }
  throw new FetchLimitError(`exceeded redirect limit ${limits.redirects}`);
};

export const isHtmlAcceptable = isHtmlContentType;
export const rethrowAsUnsafe = (cause: unknown, url: string): never => {
  if (cause instanceof UnsafeUrlError) throw cause;
  if (cause instanceof Error) throw new UnsafeUrlError(url, cause.message);
  throw new UnsafeUrlError(url, String(cause));
};
