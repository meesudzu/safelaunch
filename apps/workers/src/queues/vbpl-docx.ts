import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export class LegalParseError extends Error {
  constructor(
    readonly sourceUrl: string,
    readonly reason: string,
  ) {
    super(`Failed to parse ${sourceUrl}: ${reason}`);
    this.name = "LegalParseError";
  }
}

export interface VbplDocxMetadata {
  sourceUrl: string;
  retrievedAt: string;
  title: string;
  docNum: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface ParsedVbplProvision {
  id: string;
  article: string;
  clause: string | null;
  text: string;
  categories: string[];
}

export interface ParsedVbplDocument {
  id: string;
  sourceUrl: string;
  retrievedAt: string;
  title: string;
  docNum: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isReplaced: boolean;
  provisions: ParsedVbplProvision[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  textNodeName: "#text",
  parseAttributeValue: false,
  parseTagValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: false,
  isArray: (name: string) => ["w:p", "w:tab"].includes(name),
});

const collectParagraphs = (root: unknown): string[] => {
  if (!root || typeof root !== "object") return [];
  const visit = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) {
      const out: string[] = [];
      for (const item of value) out.push(...visit(item));
      return out;
    }
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const paragraphs = record["w:p"];
    if (Array.isArray(paragraphs)) {
      return paragraphs.map((p) =>
        typeof p === "string" ? p : p && typeof p === "object" ? extractText(p) : "",
      );
    }
    const out: string[] = [];
    for (const child of Object.values(record)) out.push(...visit(child));
    return out;
  };
  return visit(root);
};

const extractText = (paragraph: unknown): string => {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ("#text" in record && typeof record["#text"] === "string") {
        out.push(record["#text"]);
      }
      if ("w:tab" in record) {
        out.push("\t");
      }
      for (const child of Object.values(record)) visit(child);
    }
  };
  visit(paragraph);
  return out.join(" ").replace(/\s+/g, " ").trim();
};

const splitProvisions = (paragraphs: string[]): { id: string; article: string; text: string }[] => {
  const articleRegex =
    /^Điều\s+([0-9]+[a-zA-ZđĐ]?(?:\s*[.\-–]\s*[0-9]+[a-zA-ZđĐ]?)?)(?:\s*[.\-–:])?(.*)$/;
  const provisions: { id: string; article: string; text: string }[] = [];
  let current: { id: string; article: string; lines: string[] } | null = null;
  for (const paragraph of paragraphs) {
    const match = articleRegex.exec(paragraph);
    if (match) {
      if (current) {
        provisions.push({
          id: crypto.randomUUID(),
          article: current.article,
          text: current.lines.join("\n").trim(),
        });
      }
      const label = (match[1] ?? "").trim();
      const rest = (match[2] ?? "").trim();
      current = {
        id: crypto.randomUUID(),
        article: `Điều ${label}`,
        lines: rest ? [`${label}. ${rest}`] : [paragraph],
      };
      continue;
    }
    if (current) current.lines.push(paragraph);
  }
  if (current) {
    provisions.push({
      id: current.id,
      article: current.article,
      text: current.lines.join("\n").trim(),
    });
  }
  return provisions;
};

const readDate = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

export const parseVbplDocx = (
  bytes: Uint8Array,
  metadata: VbplDocxMetadata,
): ParsedVbplDocument => {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new LegalParseError(metadata.sourceUrl, "file is not a valid zip archive");
  }
  const entry = archive["word/document.xml"];
  if (!entry) throw new LegalParseError(metadata.sourceUrl, "missing word/document.xml");
  const xml = strFromU8(entry);
  const root: unknown = xmlParser.parse(xml);
  const paragraphs: string[] = collectParagraphs(root);
  if (paragraphs.length === 0) throw new LegalParseError(metadata.sourceUrl, "no paragraphs found");
  const rawProvisions = splitProvisions(paragraphs);
  if (rawProvisions.length === 0)
    throw new LegalParseError(metadata.sourceUrl, "no provisions found");
  const effectiveFrom = readDate(metadata.effectiveFrom);
  const effectiveTo = readDate(metadata.effectiveTo);
  if (!rawProvisions || rawProvisions.length === 0)
    throw new LegalParseError(metadata.sourceUrl, "no provisions matched any Điều article");
  return {
    id: metadata.docNum,
    sourceUrl: metadata.sourceUrl,
    retrievedAt: metadata.retrievedAt,
    title: metadata.title,
    docNum: metadata.docNum,
    effectiveFrom,
    effectiveTo,
    isReplaced: effectiveTo !== null,
    provisions: rawProvisions.map((provision) => ({
      id: provision.id,
      article: provision.article,
      clause: null,
      text: provision.text,
      categories: [],
    })),
  };
};
