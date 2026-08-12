import type { ReactNode } from "react";
import type { Locale } from "../lib/locale";
import { ThemeToggle } from "./theme-toggle";

export const MarketingPageShell = ({
  locale,
  path,
  children,
}: {
  readonly locale: Locale;
  readonly path: "term" | "policy" | "contact";
  readonly children: ReactNode;
}) => {
  const otherLocale = locale === "vi" ? "en" : "vi";
  return (
    <div className="technical-grid flex min-h-screen flex-col bg-bg text-ink">
      <header className="sticky top-0 z-50 border-b border-rule bg-bg/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-4 md:px-16">
          <a
            href={`/${locale}`}
            className="flex items-center gap-2 font-serif text-xl font-bold text-accent"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 fill-accent">
              <path d="M12 2 4 5v6c0 5.1 3.4 9.7 8 11 4.6-1.3 8-5.9 8-11V5l-8-3Zm0 3.2 5 1.9V11c0 3.5-2.1 6.8-5 8-2.9-1.2-5-4.5-5-8V7.1l5-1.9Zm-1 3.3v2H9v5h6v-5h-2v-2h-2Z" />
            </svg>
            SafeLaunch AI
          </a>
          <nav
            aria-label={locale === "vi" ? "Điều hướng chính" : "Main navigation"}
            className="hidden gap-7 text-xs font-bold uppercase tracking-widest text-ink-soft lg:flex"
          >
            <a href={`/${locale}/term`} className="hover:text-accent">
              {locale === "vi" ? "Điều khoản" : "Terms"}
            </a>
            <a href={`/${locale}/policy`} className="hover:text-accent">
              {locale === "vi" ? "Bảo mật" : "Privacy"}
            </a>
            <a href={`/${locale}/contact`} className="hover:text-accent">
              {locale === "vi" ? "Liên hệ" : "Contact"}
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle locale={locale} />
            <a
              href={`/${otherLocale}/${path}`}
              className="border border-rule px-3 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-ink-soft hover:border-accent hover:text-accent"
            >
              {locale === "vi" ? "VI / EN" : "EN / VI"}
            </a>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-rule bg-bg">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between md:px-16">
          <span className="font-serif text-xl font-bold text-accent">SafeLaunch AI</span>
          <nav className="flex flex-wrap gap-5 font-mono text-xs uppercase tracking-wider text-ink-soft">
            <a href={`/${locale}/policy`} className="hover:text-accent">
              {locale === "vi" ? "Chính sách bảo mật" : "Privacy policy"}
            </a>
            <a href={`/${locale}/term`} className="hover:text-accent">
              {locale === "vi" ? "Điều khoản dịch vụ" : "Terms of service"}
            </a>
            <a href={`/${locale}/contact`} className="hover:text-accent">
              {locale === "vi" ? "Liên hệ" : "Contact"}
            </a>
          </nav>
          <span className="text-xs text-ink-soft">© 2026 SafeLaunch AI</span>
        </div>
      </footer>
    </div>
  );
};

export const DocumentHeading = ({
  version,
  title,
  intro,
}: {
  readonly version: string;
  readonly title: string;
  readonly intro: string;
}) => (
  <header className="border-b border-rule pb-8">
    <div className="mb-6 flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-wider">
      <span className="border border-accent/30 bg-accent/10 px-2 py-1 text-accent">{version}</span>
      <span className="text-ink-soft">Updated: 2026-08-12</span>
    </div>
    <h1 className="font-serif text-4xl font-extrabold tracking-tight md:text-5xl">{title}</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-ink-soft">{intro}</p>
  </header>
);

export const DocumentSection = ({
  index,
  title,
  children,
}: {
  readonly index: string;
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <section
    id={`section-${index}`}
    className="scroll-mt-28 border-b border-rule py-10 last:border-0"
  >
    <div className="mb-5 flex items-baseline gap-4">
      <span className="font-mono text-xs text-accent">{index}</span>
      <h2 className="font-serif text-2xl font-bold md:text-3xl">{title}</h2>
    </div>
    <div className="space-y-5 leading-7 text-ink-soft">{children}</div>
  </section>
);
