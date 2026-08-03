import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "../lib/locale";

/**
 * Root route `/` — pick a locale from the Accept-Language header and
 * redirect to `/<locale>`. We don't render anything here; the locale
 * layout in `app/[locale]/layout.tsx` owns the actual home page.
 *
 * Default locale is `vi` (Vietnamese) per the MVP product positioning in
 * `docs/design/homepage.md`. The browser's preferred language wins when
 * the prefix matches one of the supported locales.
 */
export const dynamic = "force-dynamic";

const DEFAULT_LOCALE = "vi";

const pickLocale = (acceptLanguage: string | null): string => {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  // Parse the header — values look like "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
  const candidates = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qMatch = params.join(";").match(/q=([\d.]+)/);
      const q = qMatch ? Number.parseFloat(qMatch[1] ?? "1") : 1;
      return { tag: (tag ?? "").trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of candidates) {
    const base = tag.split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
};

export default function RootRedirect(): never {
  const acceptLanguage = headers().get("accept-language");
  const locale = pickLocale(acceptLanguage);
  redirect(`/${locale}`);
}
