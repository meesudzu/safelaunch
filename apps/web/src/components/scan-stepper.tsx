/**
 * Vertical checklist that renders every step in the scan pipeline.
 *
 * Pure presentational: takes the current scan state and a messages bundle,
 * returns the visual stepper. No polling, no side effects. Easy to test,
 * easy to embed from `scan-progress.tsx`.
 *
 * Hallmark stamp: macrostructure = Printed Checklist · archetype = Stepper
 * · theme = Paper (OKLCH palette + Source Serif 4 numerals) · studied: no
 */
export const SCAN_PIPELINE = [
  "queued",
  "fetching",
  "extracting",
  "retrieving",
  "evaluating",
  "reporting",
] as const;

export type ScanStepKey = (typeof SCAN_PIPELINE)[number];

export type ScanStepperState = ScanStepKey | "completed" | "partial" | "failed";

export interface ScanStepperMessages {
  readonly "steps.title": string;
  readonly "steps.subtitle": string;
  readonly "step.queued.label": string;
  readonly "step.queued.description": string;
  readonly "step.fetching.label": string;
  readonly "step.fetching.description": string;
  readonly "step.extracting.label": string;
  readonly "step.extracting.description": string;
  readonly "step.retrieving.label": string;
  readonly "step.retrieving.description": string;
  readonly "step.evaluating.label": string;
  readonly "step.evaluating.description": string;
  readonly "step.reporting.label": string;
  readonly "step.reporting.description": string;
}

export interface ScanStepperProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanStepperMessages;
  readonly currentState: string;
}

type RowVariant = "pending" | "active" | "completed" | "failed" | "partial";

interface RowPlan {
  readonly index: number;
  readonly step: ScanStepKey;
  readonly variant: RowVariant;
}

const computeRows = (currentState: string): readonly RowPlan[] => {
  const isTerminal =
    currentState === "completed" || currentState === "partial" || currentState === "failed";

  // For unknown / malformed states, fall back to the first pipeline step
  // (queued) as the active row. The test suite asserts this.
  const activeIndex = isTerminal
    ? -1
    : Math.max(
        0,
        SCAN_PIPELINE.findIndex((step) => step === currentState),
      );

  return SCAN_PIPELINE.map<RowPlan>((step, index) => {
    if (isTerminal) {
      if (currentState === "completed") return { index, step, variant: "completed" };
      if (currentState === "partial") {
        // All steps completed; the very last step carries the gold marker so
        // the user sees "we finished, but with a caveat" without collapsing
        // the journey.
        return {
          index,
          step,
          variant: index === SCAN_PIPELINE.length - 1 ? "partial" : "completed",
        };
      }
      // currentState === "failed" — mark the last step that was active at
      // the time of failure. For the v1 visual we mark the final step as
      // failed (we don't have a granular "which step failed" signal yet);
      // earlier steps remain completed.
      return {
        index,
        step,
        variant: index === SCAN_PIPELINE.length - 1 ? "failed" : "completed",
      };
    }
    if (index < activeIndex) return { index, step, variant: "completed" };
    if (index === activeIndex) return { index, step, variant: "active" };
    return { index, step, variant: "pending" };
  });
};

const formatSubtitle = (messages: ScanStepperMessages, current: number, total: number): string =>
  messages["steps.subtitle"]
    .replace("{current}", String(current))
    .replace("{total}", String(total));

export const ScanStepper = ({ locale, messages, currentState }: ScanStepperProps) => {
  const rows = computeRows(currentState);
  const activeIndex = rows.findIndex((row) => row.variant === "active");
  const subtitle =
    activeIndex >= 0
      ? formatSubtitle(messages, activeIndex + 1, SCAN_PIPELINE.length)
      : formatSubtitle(messages, SCAN_PIPELINE.length, SCAN_PIPELINE.length);

  return (
    <section aria-labelledby="scan-stepper-heading" data-locale={locale} className="font-sans">
      <header className="flex flex-col gap-1 pb-4">
        <h2
          id="scan-stepper-heading"
          className="font-serif text-lg font-semibold leading-snug text-ink"
        >
          {messages["steps.title"]}
        </h2>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">{subtitle}</p>
      </header>

      <ol aria-label={messages["steps.title"]} role="list" className="flex flex-col">
        {rows.map((row, position) => {
          const isLast = position === rows.length - 1;
          const labelKey = `step.${row.step}.label` as const;
          const descKey = `step.${row.step}.description` as const;
          const label = messages[labelKey];
          const description = messages[descKey];

          return (
            <li
              key={row.step}
              role="listitem"
              aria-current={row.variant === "active" ? "step" : undefined}
              className="relative flex gap-4 pb-5 last:pb-0"
            >
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-rule"
                />
              ) : null}

              <StepMarker index={position} variant={row.variant} />

              <div className="flex flex-1 flex-col gap-1 pt-1">
                <span
                  className={
                    row.variant === "active"
                      ? "text-sm font-semibold text-ink"
                      : row.variant === "pending"
                        ? "text-sm font-medium text-ink-soft"
                        : "text-sm font-medium text-ink-soft"
                  }
                >
                  {label}
                </span>
                <span
                  className={
                    row.variant === "active"
                      ? "text-xs leading-relaxed text-ink-soft"
                      : row.variant === "pending"
                        ? "text-xs leading-relaxed text-ink-soft/70"
                        : "text-xs leading-relaxed text-ink-soft/90"
                  }
                >
                  {description}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

interface MarkerProps {
  readonly index: number;
  readonly variant: RowVariant;
}

const StepMarker = ({ index, variant }: MarkerProps) => {
  // Numbered markers (serif numerals) for all states; filled color +
  // inner glyph varies by variant. Pulse only on the active row.
  const baseClasses =
    "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-serif tabular-nums";

  if (variant === "completed") {
    return (
      <span
        data-testid="step-completed"
        aria-hidden="true"
        className={`${baseClasses} border-success/40 bg-success/10 text-success`}
      >
        ✓
      </span>
    );
  }
  if (variant === "failed") {
    return (
      <span
        data-testid="step-failed"
        aria-hidden="true"
        className={`${baseClasses} border-error/50 bg-error/10 text-error`}
      >
        ✕
      </span>
    );
  }
  if (variant === "partial") {
    return (
      <span
        data-testid="step-partial"
        aria-hidden="true"
        className={`${baseClasses} border-gold/60 bg-gold/15 text-ink`}
      >
        {index + 1}
      </span>
    );
  }
  if (variant === "active") {
    // Active step: keep the step number visible AND render a thin arc that
    // spins around it. Two separate animations layered: the marker still has
    // the gentle pulse (signals "this step is the one running"), the arc
    // spins (signals "work is happening right now"). `motion-reduce:animate-none`
    // honours prefers-reduced-motion.
    return (
      <span
        aria-hidden="true"
        className={`${baseClasses} border-accent bg-accent/10 text-accent motion-reduce:animate-none motion-safe:animate-pulse relative`}
        style={{ animationDuration: "1.4s" }}
      >
        {index + 1}
        <svg
          aria-hidden="true"
          viewBox="0 0 32 32"
          className="pointer-events-none absolute inset-0 h-full w-full motion-reduce:animate-none motion-safe:animate-spin"
          style={{ animationDuration: "1.6s" }}
        >
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="22 66"
            className="text-accent/70"
          />
        </svg>
      </span>
    );
  }
  // pending
  return (
    <span aria-hidden="true" className={`${baseClasses} border-rule bg-surface text-ink-soft/70`}>
      {index + 1}
    </span>
  );
};
