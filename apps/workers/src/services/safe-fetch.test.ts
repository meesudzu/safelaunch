import { describe, expect, it } from "vitest";
import { fetchBoundedHtml, FetchLimitError } from "./safe-fetch";
import { UnsafeUrlError } from "./url-policy";

interface FakeResponseInit {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}

class FakeResponse {
  status: number;
  ok: boolean;
  headers: Map<string, string>;
  body: ReadableStream<Uint8Array> | null;
  constructor(init: FakeResponseInit) {
    this.status = init.status;
    this.ok = init.status >= 200 && init.status < 300;
    this.headers = new Map(Object.entries(init.headers ?? {}));
    this.body = init.body
      ? new ReadableStream({
          start: (controller) => {
            controller.enqueue(init.body!);
            controller.close();
          },
        })
      : null;
  }
}

class FakeFetch {
  responses: Array<FakeResponse | string>;
  calls: Array<string> = [];
  constructor(responses: Array<FakeResponse | string>) {
    this.responses = responses;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  call = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    this.calls.push(url);
    const next = this.responses.shift();
    if (typeof next === "string") {
      return new FakeResponse({ status: 302, headers: { location: next } });
    }
    if (!next) throw new Error("no more fake responses");
    return next;
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
const fakeResolve = async (hostname: string) => {
  if (hostname === "example.com") return ["93.184.216.34"];
  if (hostname === "redirect.example.com") return ["93.184.216.40"];
  if (hostname === "loopback.example.com") return ["127.0.0.1"];
  throw new Error(`no dns for ${hostname}`);
};

const buildBody = (text: string) => new TextEncoder().encode(text);

describe("fetchBoundedHtml", () => {
  it("fetches a public html page via the resolved address", async () => {
    const fake = new FakeFetch([
      new FakeResponse({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: buildBody("<html></html>") }),
    ]);
    const result = await fetchBoundedHtml({
      url: "https://example.com/",
      resolve: fakeResolve,
      fetchImpl: fake.call as unknown as typeof fetch,
    });
    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe("https://example.com/");
    expect(new TextDecoder().decode(result.bytes)).toBe("<html></html>");
  });

  it("follows a single redirect", async () => {
    const fake = new FakeFetch([
      new FakeResponse({ status: 302, headers: { location: "https://redirect.example.com/" } }),
      new FakeResponse({ status: 200, headers: { "content-type": "text/html" }, body: buildBody("<html></html>") }),
    ]);
    const result = await fetchBoundedHtml({
      url: "https://example.com/",
      resolve: fakeResolve,
      fetchImpl: fake.call as unknown as typeof fetch,
    });
    expect(result.finalUrl).toBe("https://redirect.example.com/");
  });

  it("rejects too many redirects", async () => {
    const fake = new FakeFetch([
      new FakeResponse({ status: 302, headers: { location: "https://redirect.example.com/" } }),
      new FakeResponse({ status: 302, headers: { location: "https://redirect.example.com/" } }),
      new FakeResponse({ status: 302, headers: { location: "https://redirect.example.com/" } }),
      new FakeResponse({ status: 302, headers: { location: "https://redirect.example.com/" } }),
    ]);
    await expect(
      fetchBoundedHtml({
        url: "https://example.com/",
        resolve: fakeResolve,
        fetchImpl: fake.call as unknown as typeof fetch,
        limits: { redirects: 2, compressedBytes: 1024, decodedBytes: 1024, durationMs: 5000, connectMs: 3000, accept: ["text/html"] },
      }),
    ).rejects.toThrow(FetchLimitError);
  });

  it("rejects non-html content types", async () => {
    const fake = new FakeFetch([new FakeResponse({ status: 200, headers: { "content-type": "application/json" }, body: buildBody("{}") })]);
    await expect(
      fetchBoundedHtml({
        url: "https://example.com/",
        resolve: fakeResolve,
        fetchImpl: fake.call as unknown as typeof fetch,
      }),
    ).rejects.toThrow(FetchLimitError);
  });

  it("propagates unsafe url errors", async () => {
    await expect(
      fetchBoundedHtml({
        url: "http://127.0.0.1/",
        resolve: fakeResolve,
        fetchImpl: (() => {
          throw new Error("should not be called");
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects hostnames that resolve to blocked addresses", async () => {
    const fake = new FakeFetch([]);
    await expect(
      fetchBoundedHtml({
        url: "https://loopback.example.com/",
        resolve: fakeResolve,
        fetchImpl: fake.call as unknown as typeof fetch,
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });
});
