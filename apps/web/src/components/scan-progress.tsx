"use client";

import { useEffect, useRef, useState } from "react";
import { SCAN_PIPELINE, ScanStepper, type ScanStepperMessages } from "./scan-stepper";
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
  readonly "expiry.label": string;
  readonly "coverage.title": string;
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    return messages["headline"];
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
  const attempt = useRef(0);
  const isTerminal = TERMINAL_STATES.has(state.state);

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

  // The server may return coverage without fetched/failed/skipped
  // (DB default for a freshly queued scan is `coverage_json='{}'`).
  // Defensively coerce to arrays so a malformed payload never crashes
  // the render tree. The API is also expected to normalize, but never
  // trust the wire.
  // The server may return coverage without fetched/failed/skipped
  // (DB default for a freshly queued scan is `coverage_json='{}'`).
  // Defensively coerce to arrays so a malformed payload never crashes
  // the render tree. Then dedupe across lists — fetched wins, then
  // failed, then skipped. Legacy DB rows can ship a page in more than
  // one list, which would otherwise render as contradictory rows.
  const dedupeCoverageLists = (
    fetchedList: readonly string[],
    failedList: readonly string[],
    skippedList: readonly string[],
  ): { fetched: string[]; failed: string[]; skipped: string[] } => {
    const seen = new Set<string>();
    const take = (list: readonly string[]): string[] => {
      const result: string[] = [];
      for (const item of list) {
        if (seen.has(item)) continue;
        seen.add(item);
        result.push(item);
      }
      return result;
    };
    return {
      fetched: take(fetchedList),
      failed: take(failedList),
      skipped: take(skippedList),
    };
  };

  const coverage = dedupeCoverageLists(
    Array.isArray(state.coverage?.fetched) ? state.coverage.fetched : [],
    Array.isArray(state.coverage?.failed) ? state.coverage.failed : [],
    Array.isArray(state.coverage?.skipped) ? state.coverage.skipped : [],
  );

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
          <a
            data-testid="view-report-link"
            href={state.reportUrl}
            className="inline-flex w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-surface hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {messages["view.report"]}
          </a>
        ) : null}

        <section aria-labelledby="coverage-heading" className="flex flex-col gap-2">
          <h2
            id="coverage-heading"
            className="font-serif text-sm font-semibold uppercase tracking-[0.18em] text-ink-soft"
          >
            {messages["coverage.title"]}
          </h2>
          <ul data-testid="coverage-list" className="flex flex-col gap-1 text-sm">
            {(coverage.fetched || []).map((page) => (
              <li key={`f-${page}`} className="text-success">
                ✓ {page}
              </li>
            ))}
            {(coverage.failed || []).map((page) => (
              <li key={`x-${page}`} className="text-error">
                ! {page}
              </li>
            ))}
            {(coverage.skipped || []).map((page) => (
              <li key={`s-${page}`} className="text-ink-soft">
                · {page}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
};

// suppress unused delay import warning by referencing it
void delay;
