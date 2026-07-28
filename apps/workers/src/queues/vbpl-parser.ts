export class LegalParseError extends Error {
  constructor(
    readonly sourceUrl: string,
    readonly reason: string,
  ) {
    super(`Failed to parse ${sourceUrl}: ${reason}`);
    this.name = "LegalParseError";
  }
}

export interface VbplDocumentInput {
  sourceUrl: string;
  retrievedAt: string;
  data: Record<string, unknown>;
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

const stripHtml = (input: string): string =>
  input
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

const readString = (data: Record<string, unknown>, key: string): string | null => {
  const value = data[key];
  return typeof value === "string" ? value : null;
};

const readDate = (data: Record<string, unknown>, key: string): string | null => {
  const value = data[key];
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const readCategories = (data: Record<string, unknown>): string[] => {
  const fields = data["documentFields"];
  if (!Array.isArray(fields)) return [];
  const out: string[] = [];
  for (const field of fields) {
    if (field && typeof field === "object" && "code" in field) {
      const code = (field as { code: string | null }).code;
      if (code && code !== "CHL") out.push(code);
    }
  }
  return out;
};

interface ArticleMatch {
  id: string;
  article: string;
  body: string;
}

const extractArticles = (html: string): ArticleMatch[] => {
  const articleRegex = /<p\s+id="([0-9a-fA-F-]+)"[^>]*class="prov-article"[^>]*>([\s\S]*?)<\/p>/g;
  const matches = new Map<number, ArticleMatch>();
  let match: RegExpExecArray | null;
  while ((match = articleRegex.exec(html)) !== null) {
    const id = match[1] ?? crypto.randomUUID();
    const inner = match[2] ?? "";
    const headingMatch = /<strong>\s*([^<]*?)\s*\.?\s*<\/strong>/i.exec(inner);
    if (!headingMatch) continue;
    const heading = stripHtml(headingMatch[1] ?? "").replace(/\.?\s*$/, "");
    if (heading.length === 0) continue;
    const articleLabel = heading.replace(/^Điều\s+/i, "").trim();
    const body = stripHtml(inner);
    matches.set(match.index, { id, article: `Điều ${articleLabel}`, body });
  }
  const ordered = [...matches.entries()].sort(([a], [b]) => a - b);
  return ordered.map(([, value]) => value);
};

const combineWithBody = (articles: ArticleMatch[], html: string): ArticleMatch[] => {
  if (articles.length === 0) return [];
  const segments = html.split(
    /<p\s+id="[0-9a-fA-F-]+"[^>]*class="prov-article"[^>]*>[\s\S]*?<\/p>/g,
  );
  const out: ArticleMatch[] = [];
  for (let i = 0; i < articles.length; i += 1) {
    const segment = segments[i + 1] ?? "";
    const body = stripHtml(segment);
    const text = [articles[i]?.body ?? "", body]
      .filter((part) => part.length > 0)
      .join("\n")
      .trim();
    if (!articles[i]) continue;
    out.push({ id: articles[i]!.id, article: articles[i]!.article, body: text });
  }
  return out;
};

export const parseVbplDocument = (input: VbplDocumentInput): ParsedVbplDocument => {
  const { data } = input;
  const id = readString(data, "id");
  const title = readString(data, "title");
  const docNum = readString(data, "docNum");
  const contentObj = data["documentContent"];
  const html =
    contentObj && typeof contentObj === "object"
      ? readString(contentObj as Record<string, unknown>, "content")
      : null;
  if (!id) throw new LegalParseError(input.sourceUrl, "missing document id");
  if (!title) throw new LegalParseError(input.sourceUrl, "missing title");
  if (!docNum) throw new LegalParseError(input.sourceUrl, "missing docNum");
  if (!html) throw new LegalParseError(input.sourceUrl, "missing documentContent.html");
  const articles = extractArticles(html);
  const provisions = combineWithBody(articles, html)
    .filter((article) => article.body.length > 20)
    .map((article) => ({
      id: article.id,
      article: article.article,
      clause: null,
      text: article.body,
      categories: readCategories(data),
    }));
  if (provisions.length === 0) throw new LegalParseError(input.sourceUrl, "no provisions found");
  return {
    id,
    sourceUrl: input.sourceUrl,
    retrievedAt: input.retrievedAt,
    title,
    docNum,
    effectiveFrom: readDate(data, "effFrom"),
    effectiveTo: readDate(data, "effTo"),
    isReplaced: readString(data, "effTo") !== null,
    provisions,
  };
};
