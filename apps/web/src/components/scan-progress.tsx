"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SCAN_PIPELINE, ScanStepper, type ScanStepperMessages } from "./scan-stepper";

export type ScanTerminalState = "completed" | "partial" | "failed";

export interface ScanProgressState {
  readonly scanId: string;
  readonly state: string;
  readonly status?: string;
  readonly coverage: {
    fetched: readonly string[];
    failed: readonly string[];
    skipped: readonly string[];
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
  readonly "expiry.label": string;
}

export interface ScanProgressProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanProgressMessages;
  readonly initialState: ScanProgressState;
  readonly poll: (scanId: string) => Promise<ScanProgressState>;
}

const TERMINAL_STATES = new Set<string>(["completed", "partial", "failed"]);

// Delay (ms) between the scan reaching a terminal state and the page
// navigating to the report. Long enough for sighted and screen-reader
// users to register the "Hoàn tất" / "Hoàn tất một phần" announcement,
// short enough to feel automatic. Users can also click the manual
// "Xem báo cáo" link during this window.
const AUTO_REDIRECT_DELAY_MS = 1500;

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

export const ScanProgress = ({ locale, messages, initialState, poll }: ScanProgressProps) => {
  const [state, setState] = useState<ScanProgressState>(initialState);
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

  // Auto-redirect to the report ~1.5s after the scan lands in a terminal
  // state with a usable reportUrl. We skip `failed` (no report to open)
  // and we never push the same URL twice for the same scan.
  useEffect(() => {
    if (!isTerminal) return undefined;
    if (state.state === "failed") return undefined;
    const target = state.reportUrl;
    if (!target) return undefined;
    if (redirectedRef.current === target) return undefined;

    const timer = setTimeout(() => {
      // Re-check inside the timeout in case the user unmounted or the
      // scanUrl already changed (e.g. they navigated manually).
      if (redirectedRef.current === target) return;
      redirectedRef.current = target;
      router.push(target);
    }, AUTO_REDIRECT_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isTerminal, router, state.reportUrl, state.state]);

  const headline = formatHeadline(messages, state.state);
  const announcement = stateLabel(messages, state.state);

  return (
    <section
      aria-labelledby="progress-heading"
      data-locale={locale}
      data-scan-state={state.state}
      className="bg-bg text-ink font-sans antialiased"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-2">
          <h1
            id="progress-heading"
            className="font-serif text-3xl font-semibold leading-tight md:text-4xl"
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

        <ScanStepper locale={locale} messages={messages} currentState={state.state} />

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
            href={state.reportUrl}
            data-cf-no-prefetch
            className="inline-flex w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-surface hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {messages["view.report"]}
          </a>
        ) : null}
      </div>
    </section>
  );
};
