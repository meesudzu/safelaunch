/**
 * Normalize a public URL into a stable per-day quota key.
 *
 * Rules:
 *  - lower-case the host
 *  - strip a leading "www."
 *  - drop path / query / hash (quota is per-host, not per-URL)
 *  - preserve localhost and IPv4 host literals
 *
 * Throws if the input is not a valid http(s) URL.
 */
export const domainKey = (input: string): string => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  return host;
};
