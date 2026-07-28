import { describe, expect, it } from "vitest";
import { parseVbplDocument } from "./vbpl-parser";

const sampleDocument = {
  sourceUrl: "https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/sample",
  retrievedAt: "2026-07-28T08:00:00.000Z",
  data: {
    id: "sample-1",
    title: "Nghị định số 147/2024/NĐ-CP",
    docNum: "147/2024/ND-CP",
    effFrom: "2025-01-15T00:00:00",
    effTo: null,
    documentContent: {
      content: [
        '<p id="a-1" class="prov-article"><strong>Điều 1.</strong> Quy định chung về quản lý trò chơi điện tử trên mạng.</p>',
        '<p class="prov-content">Nhà cung cấp dịch vụ phải thông báo tới Bộ Thông tin và Truyền thông trước khi phát hành.</p>',
        '<p id="a-2" class="prov-article"><strong>Điều 2.</strong> Yêu cầu về cấp phép, phân loại nội dung và nghĩa vụ bảo vệ người chơi vị thành niên.</p>',
        '<p class="prov-content">Doanh nghiệp phải xác minh tuổi người dùng bằng phương thức phù hợp trước khi cho phép truy cập nội dung hạn chế.</p>',
      ].join(""),
    },
    documentFields: [{ code: "GM" }, { code: "PR" }],
  },
};

describe("vbpl parser", () => {
  it("parses title, docNum, and provisions from a sampled payload", () => {
    const parsed = parseVbplDocument(sampleDocument);
    expect(parsed.title).toContain("147/2024/NĐ-CP");
    expect(parsed.docNum).toBe("147/2024/ND-CP");
    expect(parsed.provisions.length).toBeGreaterThan(0);
    expect(parsed.provisions[0]?.article).toBe("Điều 1");
    expect(parsed.provisions[0]?.text).toMatch(/Nhà cung cấp/);
    expect(parsed.effectiveFrom).toBe("2025-01-15");
    expect(parsed.effectiveTo).toBeNull();
    expect(parsed.isReplaced).toBe(false);
  });

  it("marks a replaced document by the presence of an effTo date", () => {
    const replaced = parseVbplDocument({
      ...sampleDocument,
      data: { ...sampleDocument.data, effTo: "2024-12-31T00:00:00" },
    });
    expect(replaced.isReplaced).toBe(true);
  });

  it("throws when a fixture lacks mandatory fields", () => {
    expect(() =>
      parseVbplDocument({ ...sampleDocument, data: { ...sampleDocument.data, title: "" } }),
    ).toThrow();
  });
});
