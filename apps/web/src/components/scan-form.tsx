"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  createApiClient,
  type CreateScanInput,
  type ScanCachedResponse,
  type ApiClient,
} from "../lib/api-client";
import { CachedBanner } from "./CachedBanner";
import { ThemeToggle } from "./theme-toggle";

const categoryValues = ["online_game", "electronic_press", "digital_entertainment"] as const;
type CategoryValue = (typeof categoryValues)[number];

export interface ScanFormMessages {
  readonly [key: string]: string;
  readonly brand: string;
  readonly "locale.switch": string;
  readonly headline: string;
  readonly subhead: string;
  readonly "trust.signals": string;
  readonly "source.citation": string;
  readonly "form.url.label": string;
  readonly "form.url.placeholder": string;
  readonly "form.url.help": string;
  readonly "form.category.label": string;
  readonly "form.category.online_game": string;
  readonly "form.category.electronic_press": string;
  readonly "form.category.digital_entertainment": string;
  readonly "form.jurisdiction.label": string;
  readonly "form.jurisdiction.value": string;
  readonly "form.submit": string;
  readonly "form.submitting": string;
  readonly "form.error.url": string;
  readonly "form.error.category": string;
  readonly "form.error.submit": string;
  readonly disclosure: string;
  readonly "footer.disclosure": string;
  readonly "footer.version": string;
  // Daily-quota + redeem-code surfaces (per spec).
  readonly "quota.disclaimer": string;
  readonly "quota.redeem.toggle": string;
  readonly "quota.redeem.label": string;
  readonly "quota.redeem.placeholder": string;
  readonly "quota.redeem.invalid": string;
  readonly "quota.redeem.used": string;
}

const categoryLabels = (messages: ScanFormMessages): Record<CategoryValue, string> => ({
  online_game: messages["form.category.online_game"],
  electronic_press: messages["form.category.electronic_press"],
  digital_entertainment: messages["form.category.digital_entertainment"],
});

const inputSchema = z.object({
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), { message: "https required" }),
  category: z.enum(categoryValues),
  redeemCode: z
    .string()
    .regex(/^SL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/)
    .optional(),
});

export interface ScanFormProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanFormMessages;
  readonly createScan?: ApiClient["createScan"];
  readonly onScanCreated?: (scanId: string) => void;
}

export const ScanForm = ({ locale, messages, createScan, onScanCreated }: ScanFormProps) => {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<CategoryValue | "">("");
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ url?: string; category?: string; submit?: string }>({});
  const [cachedResult, setCachedResult] = useState<ScanCachedResponse | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    const trimmedRedeem = redeemCode.trim().toUpperCase();
    const parsed = inputSchema.safeParse({
      url,
      category,
      redeemCode: trimmedRedeem === "" ? undefined : trimmedRedeem,
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "url") next.url = messages["form.error.url"];
        if (issue.path[0] === "category") next.category = messages["form.error.category"];
      }
      setErrors(next);
      return;
    }
    setSubmitting(true);
    try {
      const input: CreateScanInput = {
        url: parsed.data.url,
        jurisdiction: "VN",
        category: parsed.data.category,
      };
      if (parsed.data.redeemCode) input.redeemCode = parsed.data.redeemCode;
      const submit =
        createScan ??
        createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN }).createScan;
      const response = await submit(input);
      onScanCreated?.(response.scanId);
      // A cached response (200) means the daily-domain-quota returned an
      // existing scan for this domain. Render the cached banner instead of
      // navigating to the progress page.
      if ("cached" in response && response.cached === true) {
        setCachedResult(response);
        return;
      }
      // Fresh scan accepted (202) — move to the progress screen.
      router.push(`/${locale}/scan/${encodeURIComponent(response.scanId)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : messages["form.error.submit"];
      setErrors({ submit: message });
    } finally {
      setSubmitting(false);
    }
  };

  const labels = categoryLabels(messages);
  const isVi = locale === "vi";

  return (
    <section
      aria-labelledby="headline"
      data-locale={locale}
      className="flex min-h-screen flex-col bg-bg text-ink"
    >
      <header className="sticky top-0 z-50 border-b border-rule bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-16 lg:py-3">
          <a
            href={`/${locale}`}
            aria-label={messages.brand}
            className="flex items-center gap-2 font-serif text-xl font-bold text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 fill-accent">
              <path d="M12 2 4 5v6c0 5.1 3.4 9.7 8 11 4.6-1.3 8-5.9 8-11V5l-8-3Zm0 3.2 5 1.9V11c0 3.5-2.1 6.8-5 8-2.9-1.2-5-4.5-5-8V7.1l5-1.9Zm-1 3.3v2H9v5h6v-5h-2v-2h-2Z" />
            </svg>
            {messages.brand} AI
          </a>
          <div className="flex items-center gap-3">
            <ThemeToggle locale={locale} />
            <a
              href={`/${locale === "vi" ? "en" : "vi"}`}
              className="px-2 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-ink-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {messages["locale.switch"]}
            </a>
            <a
              href="#scan-form"
              className="hidden border border-accent bg-accent px-5 py-2 text-xs font-bold uppercase tracking-widest text-[#003737] hover:bg-transparent hover:text-accent sm:block"
            >
              {messages["form.submit"]}
            </a>
          </div>
        </div>
      </header>

      <div className="hero-pattern flex-1 border-b border-rule">
        <div className="relative mx-auto grid h-full max-w-7xl gap-12 px-5 py-16 md:px-16 md:py-24 lg:grid-cols-12 lg:gap-6 lg:py-12">
          <div className="flex flex-col justify-center gap-7 lg:col-span-6 lg:gap-5">
            <p className="w-max border border-rule bg-surface px-4 py-1.5 font-mono text-xs uppercase tracking-wider text-accent">
              {isVi ? "Hệ thống kiểm tra tuân thủ" : "Compliance review system"}
            </p>
            <h1
              id="headline"
              className="font-serif text-4xl font-extrabold leading-tight tracking-tight md:text-5xl"
            >
              {isVi ? "Kiểm tra tự động" : "Automated review"}
              <span className="block text-ink-soft/35">
                {isVi ? "trước khi ra mắt" : "before you launch"}
              </span>
            </h1>
            <p className="max-w-xl text-lg leading-7 text-ink-soft">{messages.subhead}</p>

            <form
              id="scan-form"
              onSubmit={(event) => {
                void handleSubmit(event);
              }}
              aria-labelledby="headline"
              className="border border-rule bg-bg p-5 md:p-6 lg:p-5"
              noValidate
            >
              <div className="flex flex-col gap-5 lg:gap-3">
                <div className="flex flex-col gap-2">
                  <label htmlFor="scan-url" className="text-sm font-medium text-ink">
                    {messages["form.url.label"]}
                  </label>
                  <input
                    id="scan-url"
                    name="url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    required
                    placeholder={messages["form.url.placeholder"]}
                    aria-describedby="scan-url-help scan-url-error"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="min-w-0 w-full border border-rule bg-bg px-4 py-3 font-mono text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent lg:py-2"
                    style={{ overflowWrap: "anywhere" }}
                  />
                  <p id="scan-url-help" className="text-xs text-ink-soft">
                    {messages["form.url.help"]}
                  </p>
                  {errors.url ? (
                    <p id="scan-url-error" role="alert" className="text-xs text-error">
                      {errors.url}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="scan-category" className="text-sm font-medium text-ink">
                    {messages["form.category.label"]}
                  </label>
                  <select
                    id="scan-category"
                    name="category"
                    required
                    aria-describedby="scan-category-error"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as CategoryValue | "")}
                    className="w-full border border-rule bg-bg px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent lg:py-2"
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {categoryValues.map((value) => (
                      <option key={value} value={value}>
                        {labels[value]}
                      </option>
                    ))}
                  </select>
                  {errors.category ? (
                    <p id="scan-category-error" role="alert" className="text-xs text-error">
                      {errors.category}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="scan-jurisdiction" className="text-sm font-medium text-ink">
                    {messages["form.jurisdiction.label"]}
                  </label>
                  <input
                    id="scan-jurisdiction"
                    name="jurisdiction"
                    type="text"
                    value={messages["form.jurisdiction.value"]}
                    disabled
                    readOnly
                    aria-readonly="true"
                    className="w-full cursor-not-allowed border border-rule bg-surface px-4 py-3 text-sm text-ink-soft lg:py-2"
                  />
                </div>

                <p
                  data-testid="scan-disclosure"
                  className="border-l-2 border-gold pl-3 text-xs italic text-ink-soft"
                >
                  {messages.disclosure}
                </p>

                <p data-testid="quota-disclaimer" className="text-xs text-ink-soft">
                  {messages["quota.disclaimer"]}
                </p>

                {cachedResult ? (
                  <CachedBanner
                    message={messages["quota.cached.banner"] ?? "Already scanned today."}
                    ctaHref={cachedResult.reportUrl}
                    ctaLabel={messages["quota.cached.cta"] ?? "Open report"}
                  />
                ) : null}

                <div data-testid="redeem-toggle">
                  <button
                    type="button"
                    onClick={() => setRedeemOpen((prev) => !prev)}
                    className="text-xs text-ink-soft underline"
                  >
                    {messages["quota.redeem.toggle"]}
                  </button>
                  {redeemOpen ? (
                    <div className="mt-2 flex flex-col gap-1">
                      <label htmlFor="scan-redeem" className="text-xs text-ink-soft">
                        {messages["quota.redeem.label"]}
                      </label>
                      <input
                        id="scan-redeem"
                        name="redeemCode"
                        type="text"
                        value={redeemCode}
                        onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
                        placeholder={messages["quota.redeem.placeholder"]}
                        data-testid="redeem-input"
                        className="w-full rounded-sm border border-rule bg-bg px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
                      />
                    </div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center whitespace-nowrap bg-accent px-4 py-4 text-xs font-bold uppercase tracking-widest text-[#003737] transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 lg:py-3"
                >
                  {submitting ? messages["form.submitting"] : messages["form.submit"]}
                </button>

                {errors.submit ? (
                  <p role="alert" className="text-xs text-error">
                    {errors.submit}
                  </p>
                ) : null}
              </div>
            </form>
          </div>

          <aside
            aria-label={isVi ? "Báo cáo mẫu" : "Sample report"}
            className="relative lg:col-span-5 lg:col-start-8"
          >
            <div className="absolute -inset-4 bg-accent/5 blur-3xl" />
            <div className="relative flex h-full flex-col border border-rule bg-bg">
              <div className="flex items-center justify-between border-b border-rule bg-surface/50 p-4 font-mono text-xs uppercase tracking-wider text-ink-soft">
                <span>{isVi ? "Báo cáo mẫu" : "Sample report"}</span>
                <span>•••</span>
              </div>
              <div className="flex flex-1 flex-col gap-6 p-5 md:p-6 lg:gap-4 lg:p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-xl font-bold">Example.vn</h2>
                    <p className="mt-1 text-sm text-ink-soft">
                      {isVi ? "Quét hoàn tất lúc 14:32" : "Scan completed at 14:32"}
                    </p>
                  </div>
                  <span className="border border-error px-3 py-1 font-mono text-xs font-bold uppercase text-error">
                    {isVi ? "Cần xem xét" : "Review"}
                  </span>
                </div>
                <div className="grid grid-cols-3 border-y border-rule py-4 lg:py-3">
                  {[
                    ["2", isVi ? "Rủi ro cao" : "High risk", "text-error"],
                    ["6", isVi ? "Cảnh báo" : "Warnings", "text-gold"],
                    ["14", isVi ? "Đạt chuẩn" : "Passed", "text-accent"],
                  ].map(([value, label, color], index) => (
                    <div
                      key={label}
                      className={`flex flex-col gap-1 ${index ? "border-l border-rule pl-4" : ""}`}
                    >
                      <strong className={`font-serif text-4xl ${color}`}>{value}</strong>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 text-sm">
                  <p className="flex justify-between border-b border-rule py-3 lg:py-2">
                    <span>
                      <b className="mr-2 text-error">×</b>
                      {isVi ? "Thiếu chính sách bảo mật" : "Missing privacy policy"}
                    </span>
                    <span className="font-mono text-[10px] text-error">CRITICAL</span>
                  </p>
                  <p className="flex justify-between border-b border-rule py-3 lg:py-2">
                    <span>
                      <b className="mr-2 text-gold">!</b>
                      {isVi ? "Thông tin giấy phép chưa đủ" : "License details incomplete"}
                    </span>
                    <span className="font-mono text-[10px] text-gold">WARN</span>
                  </p>
                  <p className="flex justify-between py-3 lg:py-2">
                    <span>
                      <b className="mr-2 text-accent">✓</b>
                      {isVi ? "Kết nối HTTPS hợp lệ" : "HTTPS connection valid"}
                    </span>
                    <span className="font-mono text-[10px] text-accent">PASS</span>
                  </p>
                </div>
                <div className="mt-auto">
                  <div className="h-1 bg-rule">
                    <div className="h-full w-[63%] bg-accent" />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-xs text-ink-soft">
                    <span>{isVi ? "Mức độ đáp ứng" : "Compliance coverage"}</span>
                    <span>63/100</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <footer className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-10 text-xs text-ink-soft md:flex-row md:items-center md:justify-between md:px-16 lg:py-4">
        <span>{messages["footer.disclosure"]}</span>
        <span>{messages["footer.version"]}</span>
      </footer>
    </section>
  );
};
