"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { createApiClient, type CreateScanInput, type ApiClient } from "../lib/api-client";

const categoryValues = [
  "online_game",
  "electronic_press",
  "digital_entertainment",
] as const;
type CategoryValue = (typeof categoryValues)[number];

export interface ScanFormMessages {
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
});

export interface ScanFormProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanFormMessages;
  readonly createScan?: ApiClient["createScan"];
}

export const ScanForm = ({ locale, messages, createScan }: ScanFormProps) => {
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<CategoryValue | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ url?: string; category?: string; submit?: string }>({});

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    const parsed = inputSchema.safeParse({ url, category });
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
      const submit = createScan ?? createApiClient().createScan;
      await submit(input);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : messages["form.error.submit"];
      setErrors({ submit: message });
    } finally {
      setSubmitting(false);
    }
  };

  const labels = categoryLabels(messages);

  return (
    <section
      aria-labelledby="headline"
      data-locale={locale}
      className="bg-bg text-ink font-sans antialiased"
    >
      <header className="flex items-center justify-between border-b border-rule px-6 py-5">
        <span className="font-serif text-xl font-semibold">{messages.brand}</span>
        <span className="text-xs uppercase tracking-wider text-ink-soft">
          {messages["locale.switch"]}
        </span>
      </header>

      <div className="mx-auto grid max-w-5xl gap-12 px-6 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
        <div className="flex flex-col gap-6">
          <h1
            id="headline"
            className="font-serif text-4xl font-semibold leading-tight md:text-5xl"
          >
            {messages.headline}
          </h1>
          <p className="text-lg text-ink-soft">{messages.subhead}</p>
          <p className="text-xs uppercase tracking-wider text-ink-soft">
            {messages["trust.signals"]}
          </p>
          <p className="text-xs text-ink-soft">{messages["source.citation"]}</p>
        </div>

        <form
          onSubmit={(event) => { void handleSubmit(event); }}
          aria-labelledby="headline"
          className="rounded-md border border-rule bg-surface p-6 shadow-sm"
          noValidate
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="scan-url"
                className="text-sm font-medium text-ink"
              >
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
                className="min-w-0 w-full rounded-sm border border-rule bg-bg px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
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
              <label
                htmlFor="scan-category"
                className="text-sm font-medium text-ink"
              >
                {messages["form.category.label"]}
              </label>
              <select
                id="scan-category"
                name="category"
                required
                aria-describedby="scan-category-error"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as CategoryValue | "")
                }
                className="w-full rounded-sm border border-rule bg-bg px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
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
              <label
                htmlFor="scan-jurisdiction"
                className="text-sm font-medium text-ink"
              >
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
                className="w-full cursor-not-allowed rounded-sm border border-rule bg-rule/40 px-3 py-2 text-sm text-ink-soft"
              />
            </div>

            <p data-testid="scan-disclosure" className="border-l-2 border-gold pl-3 text-xs italic text-ink-soft">
              {messages.disclosure}
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
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

      <footer className="mx-auto flex max-w-5xl flex-col gap-1 border-t border-rule px-6 py-6 text-xs text-ink-soft md:flex-row md:items-center md:justify-between">
        <span>{messages["footer.disclosure"]}</span>
        <span>{messages["footer.version"]}</span>
      </footer>
    </section>
  );
};
