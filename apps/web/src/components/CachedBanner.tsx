import type { ReactNode } from "react";

export interface CachedBannerProps {
  readonly message: string;
  readonly ctaHref: string | null;
  readonly ctaLabel: string;
}

export const CachedBanner = ({ message, ctaHref, ctaLabel }: CachedBannerProps): ReactNode => (
  <div
    role="status"
    data-testid="cached-banner"
    className="rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-ink"
  >
    <p>{message}</p>
    {ctaHref ? (
      <a
        href={ctaHref}
        className="mt-2 inline-flex rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-surface hover:bg-accent-hover"
      >
        {ctaLabel}
      </a>
    ) : null}
  </div>
);
