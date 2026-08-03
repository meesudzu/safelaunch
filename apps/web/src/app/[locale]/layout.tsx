import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isLocale, locales } from "../../lib/locale";

export type { Locale } from "../../lib/locale";

// export const dynamicParams = false; // disabled for OpenNext Cloudflare compat

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return <>{children}</>;
}
