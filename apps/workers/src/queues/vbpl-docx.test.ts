import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { XMLBuilder } from "fast-xml-parser";
import { parseVbplDocx } from "./vbpl-docx";

const buildDocx = (paragraphs: string[]): Uint8Array => {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    indentBy: "  ",
    suppressEmptyNode: false,
  });
  const xml = builder.build({
    "w:document": {
      "@_xmlns:w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "w:body": paragraphs.map((text) => ({ "w:p": [{ "w:r": [{ "w:t": text }] }] })),
    },
  });
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(doc),
  });
};

const sampleBytes = buildDocx([
  "Điều 1. Phạm vi áp dụng và đối tượng quản lý.",
  "Quy định này áp dụng cho doanh nghiệp cung cấp dịch vụ trò chơi trực tuyến.",
  "Điều 2. Yêu cầu bảo vệ người chơi vị thành niên.",
  "Hệ thống phải xác minh độ tuổi trước khi cho phép truy cập nội dung có giới hạn độ tuổi.",
]);

const sampleMetadata = {
  sourceUrl: "https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/sample",
  retrievedAt: "2026-07-28T08:00:00.000Z",
  title: "Mẫu nghị định trò chơi trực tuyến",
  docNum: "298/2026/ND-CP",
  effectiveFrom: "2026-08-10T00:00:00",
  effectiveTo: null,
};

describe("vbpl docx parser", () => {
  it("parses Điều-level provisions from an in-memory DOCX", () => {
    const parsed = parseVbplDocx(sampleBytes, sampleMetadata);
    expect(parsed.docNum).toBe("298/2026/ND-CP");
    expect(parsed.provisions).toHaveLength(2);
    expect(parsed.provisions[0]?.article).toBe("Điều 1");
    expect(parsed.provisions[0]?.text).toMatch(/Phạm vi áp dụng/);
    expect(parsed.provisions[1]?.text).toMatch(/xác minh độ tuổi/);
    expect(parsed.isReplaced).toBe(false);
    expect(parsed.effectiveFrom).toBe("2026-08-10");
  });

  it("rejects a non-DOCX payload with a clear error", () => {
    expect(() => parseVbplDocx(new TextEncoder().encode("<html></html>"), sampleMetadata)).toThrow(
      /not a valid zip archive/,
    );
  });

  it("rejects a document with no Điều articles", () => {
    const blank = buildDocx(["Không có điều khoản nào ở đây."]);
    expect(() => parseVbplDocx(blank, sampleMetadata)).toThrow(/no provisions/);
  });
});
