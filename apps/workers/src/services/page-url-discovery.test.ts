import { describe, expect, it } from "vitest";
import { discoverPageUrls, type PageUrlMap } from "./page-url-discovery";

describe("discoverPageUrls", () => {
  it("matches Vietnamese about-link in a dantri-style footer", () => {
    const html = `
      <html>
        <body>
          <main><h1>Tin tức</h1></main>
          <footer>
            <ul>
              <li><a href="/gioi-thieu">Giới thiệu</a></li>
              <li><a href="/chinh-sach-bao-mat">Chính sách bảo mật</a></li>
              <li><a href="/dieu-khoan">Điều khoản</a></li>
              <li><a href="/lien-he">Liên hệ</a></li>
            </ul>
          </footer>
        </body>
      </html>
    `;
    const map = discoverPageUrls("https://dantri.com.vn", html);
    expect(map.about).toBe("https://dantri.com.vn/gioi-thieu");
    expect(map.privacy).toBe("https://dantri.com.vn/chinh-sach-bao-mat");
    expect(map.terms).toBe("https://dantri.com.vn/dieu-khoan");
    expect(map.contact).toBe("https://dantri.com.vn/lien-he");
  });

  it("matches English privacy-policy link and ignores CDN anchors", () => {
    const html = `
      <html>
        <body>
          <main>...</main>
          <footer>
            <a href="https://cdn.example.com/logo.png"><img src="/x.png"/></a>
            <a href="/about">About Us</a>
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms-of-service">Terms of Service</a>
            <a href="/contact">Contact</a>
          </footer>
        </body>
      </html>
    `;
    const map = discoverPageUrls("https://example.com", html);
    expect(map.about).toBe("https://example.com/about");
    expect(map.privacy).toBe("https://example.com/privacy-policy");
    expect(map.terms).toBe("https://example.com/terms-of-service");
    expect(map.contact).toBe("https://example.com/contact");
    // The CDN image anchor must NOT bleed into the URL map.
    expect(Object.values(map)).not.toContain("https://cdn.example.com/logo.png");
  });

  it("falls back to slug match when anchor text is missing", () => {
    // Anchor text is the literal "/" link; the URL slug carries the signal.
    const html = `
      <html><body>
        <footer>
          <a href="/chinh-sach-bao-mat">/</a>
          <a href="/dieu-khoan-su-dung">/</a>
        </footer>
      </body></html>
    `;
    const map = discoverPageUrls("https://example.com", html);
    expect(map.privacy).toBe("https://example.com/chinh-sach-bao-mat");
    expect(map.terms).toBe("https://example.com/dieu-khoan-su-dung");
  });

  it("uses bottom-half fallback when no <footer> tag is present", () => {
    // Vietnamese news sites sometimes put link lists in a <ul> at the
    // bottom of <body> without a <footer> wrapper.
    const padding = "<p>" + "x".repeat(2000) + "</p>";
    const html = `
      <html><body>
        ${padding}
        <ul class="site-links">
          <li><a href="/gioi-thieu">Giới thiệu</a></li>
          <li><a href="/lien-he">Liên hệ</a></li>
        </ul>
      </body></html>
    `;
    const map = discoverPageUrls("https://example.com", html);
    expect(map.about).toBe("https://example.com/gioi-thieu");
    expect(map.contact).toBe("https://example.com/lien-he");
  });

  it("returns empty map for a page with no matching links", () => {
    const html = `
      <html><body>
        <footer>
          <a href="/random">Just a random page</a>
          <a href="/">Home</a>
        </footer>
      </body></html>
    `;
    const map: PageUrlMap = discoverPageUrls("https://example.com", html);
    expect(map).toEqual({});
  });

  it("ignores cross-origin anchors entirely", () => {
    const html = `
      <html><body>
        <footer>
          <a href="https://other.com/about">About</a>
          <a href="https://other.com/privacy">Privacy</a>
          <a href="/privacy">Privacy</a>
        </footer>
      </body></html>
    `;
    const map = discoverPageUrls("https://example.com", html);
    expect(map.privacy).toBe("https://example.com/privacy");
    expect(map.about).toBeUndefined();
  });

  it("matches Vietnamese / English mixed case + diacritics", () => {
    const html = `
      <html><body><footer>
        <a href="/gioi-thieu">GIỚI THIỆU</a>
        <a href="/about-us">About Us</a>
      </footer></body></html>
    `;
    const map = discoverPageUrls("https://example.com", html);
    // First-match-wins by document order: "GIỚI THIỆU" wins for `about`.
    expect(map.about).toBe("https://example.com/gioi-thieu");
  });
});

describe("discoverPageUrls — real-world URL regression (locked against dantri + 24h.com.vn)", () => {
  it("matches dantri.com.vn nested privacy URL + standard slugs", () => {
    // User-reported 2026-08-05: dantri's privacy page lives at a deep
    // /cong-nghe/<article-slug>.htm path, not at /privacy or /chinh-sach.
    // Discovery must walk every path segment, not just the last.
    const html = `
      <html><body><footer>
        <a href="https://dantri.com.vn/gioi-thieu.htm">Giới thiệu</a>
        <a href="https://dantri.com.vn/cong-nghe/chinh-sach-bao-mat-du-lieu-ca-nhan-20190514153010649.htm">Chính sách</a>
        <a href="https://dantri.com.vn/dieu-khoan-su-dung.htm">Điều khoản</a>
        <a href="https://dantri.com.vn/lien-he.htm">Liên hệ</a>
      </footer></body></html>
    `;
    const map = discoverPageUrls("https://dantri.com.vn", html);
    expect(map.about).toBe("https://dantri.com.vn/gioi-thieu.htm");
    expect(map.privacy).toBe(
      "https://dantri.com.vn/cong-nghe/chinh-sach-bao-mat-du-lieu-ca-nhan-20190514153010649.htm",
    );
    expect(map.terms).toBe("https://dantri.com.vn/dieu-khoan-su-dung.htm");
    expect(map.contact).toBe("https://dantri.com.vn/lien-he.htm");
  });

  it("matches 24h.com.vn .html slugs (no nested path)", () => {
    const html = `
      <html><body><footer>
        <a href="https://www.24h.com.vn/chinh-sach-bao-mat.html">Chính sách bảo mật</a>
        <a href="https://www.24h.com.vn/dieu-khoan-su-dung.html">Điều khoản sử dụng</a>
        <a href="https://www.24h.com.vn/gioi-thieu.html">Giới thiệu</a>
        <a href="https://www.24h.com.vn/lien-he.html">Liên hệ</a>
      </footer></body></html>
    `;
    const map = discoverPageUrls("https://www.24h.com.vn", html);
    expect(map.privacy).toBe("https://www.24h.com.vn/chinh-sach-bao-mat.html");
    expect(map.terms).toBe("https://www.24h.com.vn/dieu-khoan-su-dung.html");
    expect(map.about).toBe("https://www.24h.com.vn/gioi-thieu.html");
    expect(map.contact).toBe("https://www.24h.com.vn/lien-he.html");
  });

  it("matches the đ (U+0111) keyword even when slug is unaccented", () => {
    // Regression test for the đ normalization bug: without
    // replace(/[Đđ]/g, "d"), "điều khoản" stays as "điều khoản" after
    // NFD+strip and fails to match the slug "dieu khoan su dung".
    const html = `
      <html><body><footer>
        <a href="/dieu-khoan-su-dung.html">/</a>
      </footer></body></html>
    `;
    const map = discoverPageUrls("https://example.com", html);
    expect(map.terms).toBe("https://example.com/dieu-khoan-su-dung.html");
  });
});

