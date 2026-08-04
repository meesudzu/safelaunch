"use client";

import { useEffect, useRef, useState } from "react";

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

export interface ScanProgressMessages {
  readonly headline: string;
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
  readonly "view.retrying": string;
  readonly "expiry.label": string;
}

export interface ScanProgressProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanProgressMessages;
  readonly initialState: ScanProgressState;
  readonly poll: (scanId: string) => Promise<ScanProgressState>;
}

const TERMINAL_STATES = new Set(["completed", "partial", "failed"]);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt: number): number => {
  if (attempt <= 1) return 1000;
  if (attempt === 2) return 2000;
  return 3000;
};

export const ScanProgress = ({ locale, messages, initialState, poll }: ScanProgressProps) => {
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

  const stateLabel = ((): string => {
    const key = `state.${state.state}` as keyof ScanProgressMessages;
    return messages[key] ?? state.state;
  })();

  return (
    <section
      aria-labelledby="progress-heading"
      data-locale={locale}
      data-scan-state={state.state}
      className="bg-bg text-ink font-sans antialiased"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <h1
          id="progress-heading"
          className="font-serif text-3xl font-semibold leading-tight md:text-4xl"
        >
          {messages.headline}
        </h1>
        <p data-testid="progress-state" className="text-base text-ink-soft">
          {stateLabel}
        </p>

        {state.reportUrl && TERMINAL_STATES.has(state.state) ? (
          <a
            data-testid="view-report-link"
            href={state.reportUrl}
            className="inline-flex w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-surface hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {messages["view.report"]}
          </a>
        ) : null}

        {!TERMINAL_STATES.has(state.state) ? (
          <p className="text-xs text-ink-soft">{messages["view.retrying"]}</p>
        ) : null}

        <ul className="flex flex-col gap-1 text-sm">
          {state.coverage.fetched.map((page) => (
            <li key={`f-${page}`} className="text-success">
              ✓ {page}
            </li>
          ))}
          {state.coverage.failed.map((page) => (
            <li key={`x-${page}`} className="text-error">
              ! {page}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

// suppress unused delay import warning by referencing it
void delay;
