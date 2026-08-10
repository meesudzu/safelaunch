"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SCAN_PIPELINE, ScanStepper, type ScanStepperMessages } from "./scan-stepper";
import { ThemeToggle } from "./theme-toggle";
import { createApiClient } from "../lib/api-client";

export type ScanTerminalState = "completed" | "partial" | "failed";

export interface ScanProgressState {
  readonly scanId: string;
  readonly state: string;
  readonly status?: string;
  readonly coverage: {
    fetched?: readonly string[];
    failed?: readonly string[];
    skipped?: readonly string[];
  };
  readonly expiresAt?: string;
  readonly reportUrl?: string;
}

export interface ScanProgressMessages extends ScanStepperMessages {
  readonly headline: string;
  readonly "headline.scanning": string;
  readonly "state.queued": string;
  readonly "state.fetching": string;
  readonly "state.extracting": string;
  readonly "state.retrieving": string;
  readonly "state.evaluating": string;
  readonly "state.reporting": string;
  readonly "state.completed": string;
  readonly "state.partial": string;
  readonly "state.failed": string;
  readonly "view.report": string;
  readonly "redirect.countdown": string;
  readonly "expiry.label": string;
}

export interface ScanProgressProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanProgressMessages;
  readonly initialState: ScanProgressState;
  readonly poll?: (scanId: string) => Promise<ScanProgressState>;
}

const defaultPoll = (scanId: string): Promise<ScanProgressState> =>
  createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN }).getScan(scanId);

const TERMINAL_STATES = new Set<string>(["completed", "partial", "failed"]);

const AUTO_REDIRECT_SECONDS = 3;

const reportHref = (url: string): string => {
  try {
    const parsed = new URL(url, "https://local.invalid");
    return /^\/(?:vi|en)\/report\/[^/]+$/.test(parsed.pathname)
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : url;
  } catch {
    return url;
  }
};

const backoffMs = (attempt: number): number => {
  if (attempt <= 1) return 1000;
  if (attempt === 2) return 2000;
  return 3000;
};

const formatExpiry = (iso: string, locale: "vi" | "en"): string => {
  // Use Intl.DateTimeFormat so the same ISO string renders as a localized
  // date in both vi (Asia/Ho_Chi_Minh) and en (UTC) without leaking the
  // raw ISO shape to the user.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(date);
  } catch {
    return iso;
  }
};

const formatHeadline = (messages: ScanProgressMessages, state: string): string => {
  if (state === "completed") return messages["state.completed"];
  if (state === "partial") return messages["state.partial"];
  if (state === "failed") return messages["state.failed"];
  const activeIndex = SCAN_PIPELINE.findIndex((step) => step === state);
  if (activeIndex < 0) {
    // Unknown state — keep the original static headline so the screen never
    // blanks out before the first valid poll lands.
    return messages.headline;
  }
  return messages["headline.scanning"]
    .replace("{current}", String(activeIndex + 1))
    .replace("{total}", String(SCAN_PIPELINE.length));
};

const stateLabel = (messages: ScanProgressMessages, state: string): string => {
  const key = `state.${state}` as keyof ScanProgressMessages;
  const value = messages[key];
  return typeof value === "string" ? value : state;
};

export const ScanProgress = ({
  locale,
  messages,
  initialState,
  poll = defaultPoll,
}: ScanProgressProps) => {
  const [state, setState] = useState<ScanProgressState>(initialState);
  const [redirectSeconds, setRedirectSeconds] = useState(AUTO_REDIRECT_SECONDS);
  const attempt = useRef(0);
  // Tracks the reportUrl we've already navigated to so duplicate terminal
  // polls (same URL) don't fire `router.push` twice. Reset when the URL
  // changes to a new scan/report.
  const redirectedRef = useRef<string | null>(null);
  const isTerminal = TERMINAL_STATES.has(state.state);
  const router = useRouter();

  useEffect(() => {
    if (isTerminal) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      attempt.current += 1;
      try {
        const next = await poll(state.scanId);
        if (cancelled) return;
        setState(next);
        if (!TERMINAL_STATES.has(next.state)) {
          timer = setTimeout(() => {
            void tick();
          }, backoffMs(attempt.current));
        }
      } catch {
        if (cancelled) return;
        // Transient error — back off and retry.
        timer = setTimeout(() => {
          void tick();
        }, backoffMs(attempt.current));
      }
    };

    timer = setTimeout(() => {
      void tick();
    }, backoffMs(attempt.current));

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isTerminal, poll, state.scanId]);

  // Count down before opening a completed report. Failed scans stay put.
  useEffect(() => {
    if (!isTerminal) return undefined;
    if (state.state === "failed") return undefined;
    const target = state.reportUrl ? reportHref(state.reportUrl) : undefined;
    if (!target) return undefined;
    if (redirectedRef.current === target) return undefined;

    let remaining = AUTO_REDIRECT_SECONDS;
    setRedirectSeconds(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setRedirectSeconds(remaining);
        return;
      }
      clearInterval(timer);
      if (redirectedRef.current === target) return;
      redirectedRef.current = target;
      router.push(target);
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isTerminal, router, state.reportUrl, state.state]);

  const headline = formatHeadline(messages, state.state);
  const announcement = stateLabel(messages, state.state);
  const activeIndex = SCAN_PIPELINE.findIndex((step) => step === state.state);
  const progressPercent = isTerminal
    ? 100
    : Math.round(((Math.max(activeIndex, 0) + 1) / SCAN_PIPELINE.length) * 100);

  return (
    <section
      aria-labelledby="progress-heading"
      data-locale={locale}
      data-scan-state={state.state}
      className="technical-grid min-h-screen bg-bg text-ink font-sans antialiased"
    >
      <header className="border-b border-rule bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-16">
          <a
            href={`/${locale}`}
            className="flex items-center gap-2 font-serif text-xl font-bold text-accent"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 fill-accent">
              <path d="M12 2 4 5v6c0 5.1 3.4 9.7 8 11 4.6-1.3 8-5.9 8-11V5l-8-3Zm0 3.2 5 1.9V11c0 3.5-2.1 6.8-5 8-2.9-1.2-5-4.5-5-8V7.1l5-1.9Zm-1 3.3v2H9v5h6v-5h-2v-2h-2Z" />
            </svg>
            SafeLaunch AI
          </a>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">
              {locale === "vi" ? "Đang phân tích" : "Analysis running"}
            </span>
            <ThemeToggle locale={locale} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 md:px-16 md:py-20 lg:grid-cols-12">
        <main className="flex flex-col gap-8 lg:col-span-7">
          <header className="flex flex-col gap-3">
            <p className="w-fit border border-rule bg-surface px-3 py-1 font-mono text-xs uppercase tracking-wider text-accent">
              {locale === "vi" ? "Quét tuân thủ trực tiếp" : "Live compliance scan"}
            </p>
            <h1
              id="progress-heading"
              className="whitespace-nowrap font-serif text-2xl font-extrabold leading-tight tracking-tight md:text-4xl"
            >
              {headline}
            </h1>
            {/* Visually hidden but announced: this is the single source of
              truth for "what step is the scan on right now" that screen
              readers read on every state transition. The visual stepper
              below carries the same information for sighted users. */}
            <span
              data-testid="progress-state"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {announcement}
            </span>
          </header>

          <div className="border border-rule bg-bg p-5 md:p-7">
            <ScanStepper locale={locale} messages={messages} currentState={state.state} />
          </div>

          {state.expiresAt && isTerminal ? (
            <p data-testid="progress-expiry" className="text-xs text-ink-soft">
              {messages["expiry.label"]} {formatExpiry(state.expiresAt, locale)}
            </p>
          ) : null}

          {state.reportUrl && isTerminal ? (
            // data-cf-no-prefetch: opt out of Cloudflare Speed Brain prefetch.
            // Speed Brain is enabled on this site (/cdn-cgi/speculation serves
            // a rule with href_matches:"/*" and conservative eagerness, which
            // prefetches same-origin links on hover/viewport). Keeping the
            // opt-out avoids pulling the (heavy) report HTML on hover — the
            // redirect below handles the navigation the user actually wants.
            <a
              data-testid="view-report-link"
              href={reportHref(state.reportUrl)}
              data-cf-no-prefetch
              className="inline-flex w-fit bg-accent px-6 py-3 text-xs font-bold uppercase tracking-widest text-[#003737] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {messages["view.report"]}
            </a>
          ) : null}
          {state.reportUrl && isTerminal && state.state !== "failed" ? (
            <p data-testid="redirect-countdown" role="status" className="text-xs text-ink-soft">
              {messages["redirect.countdown"].replace("{seconds}", String(redirectSeconds))}
            </p>
          ) : null}
        </main>

        <aside className="self-start lg:col-span-4 lg:col-start-9 lg:mt-[7.25rem]">
          <div className="border border-rule bg-bg">
            <div className="flex items-center justify-between border-b border-rule bg-surface/50 p-4 font-mono text-xs uppercase tracking-wider text-ink-soft">
              <span>{locale === "vi" ? "Trạng thái hệ thống" : "System status"}</span>
              <span className="text-accent">● LIVE</span>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-rule">
              <div className="bg-bg p-4">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  Scan ID
                </dt>
                <dd className="mt-2 truncate font-mono text-xs text-accent" title={state.scanId}>
                  {state.scanId}
                </dd>
              </div>
              <div className="bg-bg p-4">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  {locale === "vi" ? "Giai đoạn" : "Stage"}
                </dt>
                <dd className="mt-2 text-sm font-bold uppercase">{announcement}</dd>
              </div>
              <div className="bg-bg p-4">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  {locale === "vi" ? "Đã tải" : "Fetched"}
                </dt>
                <dd className="mt-2 font-serif text-3xl font-bold text-accent">
                  {state.coverage.fetched?.length ?? 0}
                </dd>
              </div>
              <div className="bg-bg p-4">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  {locale === "vi" ? "Lỗi" : "Failed"}
                </dt>
                <dd className="mt-2 font-serif text-3xl font-bold text-error">
                  {state.coverage.failed?.length ?? 0}
                </dd>
              </div>
            </dl>
            <div className="p-5">
              <div className="h-1 bg-rule">
                <div
                  className="h-full bg-accent transition-[width] duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between font-mono text-xs text-ink-soft">
                <span>{locale === "vi" ? "Tiến độ" : "Progress"}</span>
                <span>{progressPercent}%</span>
              </div>
            </div>
          </div>
          <div aria-hidden="true" className="hidden h-52 items-center justify-center lg:flex">
            <img src="/images/ai-reading.gif" alt="" className="h-48 w-auto" />
          </div>
        </aside>
      </div>
    </section>
  );
};
