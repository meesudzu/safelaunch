import { notFound } from "next/navigation";
import type { ReactNode } from "react";

const locales = ["vi", "en"] as const;
export type Locale = (typeof locales)[number];
const isLocale = (value: string): value is Locale =>
  (locales as readonly string[]).includes(value);

export const dynamicParams = false;

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
