"use client";

import { useState } from "react";

import type {
  AssetRightsSummary,
  DigitalAsset,
  LicenseCheck,
  OverallReportStatus,
  ReportFinding,
  ScanCoverage,
  ServiceSignal,
} from "@safelaunch/contracts";

export interface ReportMessages {
  readonly brand: string;
  readonly "locale.switch": string;
  readonly title: string;
  readonly "ai.badge": string;
  readonly "coverage.label": string;
  readonly "coverage.fetched": string;
  readonly "coverage.failed": string;
  readonly "coverage.skipped": string;
  readonly "status.high_risk": string;
  readonly "status.needs_review": string;
  readonly "status.no_significant_risk": string;
  readonly "finding.severity.high": string;
  readonly "finding.severity.review": string;
  readonly "finding.severity.pass": string;
  readonly "finding.applicability.current": string;
  readonly "finding.applicability.upcoming": string;
  readonly "finding.confidence": string;
  readonly "finding.recommended_action": string;
  readonly "finding.evidence": string;
  readonly "finding.legal_excerpt": string;
  readonly "finding.source": string;
  readonly "finding.retrieved_at": string;
  readonly "finding.provision_link": string;
  readonly "finding.source_link_unavailable": string;
  readonly "upcoming.banner": string;
  readonly "expiry.label": string;
  readonly disclaimer: string;
  readonly "footer.disclosure": string;
  readonly "footer.version": string;
  readonly "service.signals.title": string;
  readonly "license.checks.title": string;
  readonly "asset.inventory.title": string;
  readonly "asset.inventory.summary": string;
  readonly "asset.inventory.flagged": string;
  readonly "asset.inventory.scope"?: string;
}

export interface ReportFindingCard extends ReportFinding {
  readonly evidenceExcerpt: string;
  readonly upcomingEffectiveAt: string | null;
}

export interface ReportPayload {
  readonly scanId: string;
  readonly jurisdiction: string;
  readonly category: "online_game" | "electronic_press" | "digital_entertainment";
  readonly status: OverallReportStatus;
  readonly coverage: ScanCoverage;
  readonly findings: readonly ReportFindingCard[];
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly rubricVersion: string;
  readonly serviceSignals?: readonly ServiceSignal[];
  readonly licenseChecks?: readonly LicenseCheck[];
  readonly assetInventory?: {
    readonly assets: readonly DigitalAsset[];
    readonly summary: AssetRightsSummary;
  };
}

type Severity = "high" | "review" | "pass";

const statusLabel = (messages: ReportMessages, status: OverallReportStatus): string => {
  switch (status) {
    case "high_risk":
      return messages["status.high_risk"];
    case "needs_review":
      return messages["status.needs_review"];
    case "no_significant_risk":
      return messages["status.no_significant_risk"];
  }
};

const severityLabel = (messages: ReportMessages, severity: Severity): string => {
  switch (severity) {
    case "high":
      return messages["finding.severity.high"];
    case "review":
      return messages["finding.severity.review"];
    case "pass":
      return messages["finding.severity.pass"];
  }
};

const severityCardClass = (severity: Severity): string => {
  switch (severity) {
    case "high":
      return "border-l-error bg-error/5";
    case "review":
      return "border-l-gold bg-gold/10";
    case "pass":
      return "border-l-success bg-success/5";
  }
};

const severityBadgeClass = (severity: Severity): string => {
  switch (severity) {
    case "high":
      return "border-error text-error";
    case "review":
      return "border-gold text-ink";
    case "pass":
      return "border-success text-success";
  }
};

const severityAccentClass = (severity: Severity): string => {
  switch (severity) {
    case "high":
      return "border-error text-error bg-error";
    case "review":
      return "border-gold text-ink bg-gold";
    case "pass":
      return "border-success text-success bg-success";
  }
};

const statusBannerClass = (status: OverallReportStatus): string => {
  switch (status) {
    case "high_risk":
      return "border-error bg-error/10";
    case "needs_review":
      return "border-gold bg-gold/10";
    case "no_significant_risk":
      return "border-success bg-success/10";
  }
};

const serviceSignalLabel = (locale: "vi" | "en", kind: ServiceSignal["kind"]): string => {
  const labels =
    locale === "vi"
      ? {
          login: "Đăng nhập/đăng ký",
          ugc: "Nội dung người dùng",
          public_profile: "Hồ sơ công khai",
          content_feed: "Feed nội dung",
          follow_or_friend: "Theo dõi/kết bạn",
          comment: "Bình luận",
          share: "Chia sẻ",
          editorial_publishing: "Xuất bản biên tập",
        }
      : {
          login: "Login/registration",
          ugc: "User-generated content",
          public_profile: "Public profile",
          content_feed: "Content feed",
          follow_or_friend: "Follow/friend",
          comment: "Comments",
          share: "Sharing",
          editorial_publishing: "Editorial publishing",
        };
  return labels[kind];
};

const licenseTypeLabel = (locale: "vi" | "en", value: string): string => {
  const labels =
    locale === "vi"
      ? {
          online_game: "Trò chơi điện tử",
          electronic_press: "Báo chí điện tử",
          social_network: "Mạng xã hội",
        }
      : {
          online_game: "Online game",
          electronic_press: "Electronic press",
          social_network: "Social network",
        };
  return labels[value as keyof typeof labels] ?? value;
};

const formatDate = (iso: string, locale: "vi" | "en"): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

export interface ReportViewProps {
  readonly locale: "vi" | "en";
  readonly messages: ReportMessages;
  readonly report: ReportPayload;
}

export const ReportView = ({ locale, messages, report }: ReportViewProps) => {
  const failedPages = report.coverage.failed;
  const isPartial = failedPages.length > 0;

  // Group findings by severity for the tab strip. Within a tab we keep the
  // current/upcoming order intact so the temporal signal is still visible
  // alongside the severity grouping.
  const sortedBySeverity = (sev: Severity): readonly ReportFindingCard[] => {
    const sameSeverity = report.findings.filter((f) => f.severity === sev);
    return [
      ...sameSeverity.filter((f) => f.applicability === "current"),
      ...sameSeverity.filter((f) => f.applicability === "upcoming"),
    ];
  };

  const allTabs = (["high", "review", "pass"] as const).map((sev) => ({
    severity: sev,
    findings: sortedBySeverity(sev),
  }));
  const visibleTabs = allTabs.filter((t) => t.findings.length > 0);

  const defaultTab: Severity | null =
    visibleTabs.find((t) => t.severity === "high")?.severity ??
    visibleTabs[0]?.severity ??
    null;

  const [activeTab, setActiveTab] = useState<Severity | null>(defaultTab);

  const totalFindings = report.findings.length;

  return (
    <section
      aria-labelledby="report-title"
      data-locale={locale}
      data-coverage={isPartial ? "partial" : "complete"}
      className="bg-bg text-ink font-sans antialiased"
    >
      <header className="flex items-center justify-between border-b border-rule px-6 py-5">
        <span className="font-serif text-xl font-semibold">{messages.brand}</span>
        <span className="text-xs uppercase tracking-wider text-ink-soft">
          {messages["locale.switch"]}
        </span>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 md:py-16">
        <div className="flex flex-col gap-3">
          <p
            data-testid="report-ai-badge"
            className="inline-flex w-fit items-center gap-2 rounded-sm border border-gold px-2 py-1 text-xs uppercase tracking-wider text-ink-soft"
          >
            <span aria-hidden="true">AI</span>
            <span>{messages["ai.badge"]}</span>
          </p>
          <h1
            id="report-title"
            className="font-serif text-3xl font-semibold leading-tight md:text-4xl"
          >
            {messages.title}
          </h1>
          <div
            data-testid="report-status-banner"
            data-status={report.status}
            className={`rounded-md border p-5 ${statusBannerClass(report.status)}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              {locale === "vi" ? "Tình trạng tổng" : "Overall status"}
            </p>
            <p className="mt-2 text-base font-semibold">
              {statusLabel(messages, report.status)}
            </p>
          </div>
        </div>

        <section
          aria-labelledby="coverage-heading"
          className="rounded-md border border-rule bg-surface p-5"
        >
          <h2
            id="coverage-heading"
            className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
          >
            {messages["coverage.label"]}
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {report.coverage.fetched.map((page) => (
              <li key={`fetched-${page}`} className="flex gap-2">
                <span aria-hidden="true" className="text-success">
                  ✓
                </span>
                <span>
                  {messages["coverage.fetched"]}: {page}
                </span>
              </li>
            ))}
            {failedPages.map((page) => (
              <li
                key={`failed-${page}`}
                data-testid={`coverage-failed-${page}`}
                className="flex gap-2 text-error"
              >
                <span aria-hidden="true">!</span>
                <span>
                  {messages["coverage.failed"]}: {page}
                </span>
              </li>
            ))}
            {report.coverage.skipped.map((page) => (
              <li key={`skipped-${page}`} className="flex gap-2 text-ink-soft">
                <span aria-hidden="true">·</span>
                <span>
                  {messages["coverage.skipped"]}: {page}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {report.findings.some((f) => f.applicability === "upcoming") ? (
          <section
            aria-labelledby="upcoming-heading"
            data-testid="upcoming-banner"
            className="rounded-md border border-gold bg-gold/10 p-5"
          >
            <h2
              id="upcoming-heading"
              className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
            >
              <span data-testid="upcoming-banner-label">{messages["upcoming.banner"]}</span>{" "}
              {(() => {
                const nextUpcoming = report.findings.find(
                  (f) => f.applicability === "upcoming" && f.upcomingEffectiveAt,
                );
                return nextUpcoming?.upcomingEffectiveAt
                  ? formatDate(nextUpcoming.upcomingEffectiveAt, locale)
                  : "";
              })()}
            </h2>
            <p className="mt-2 text-sm text-ink">
              {report.findings.find((f) => f.applicability === "upcoming")?.rationale}
            </p>
          </section>
        ) : null}

        {report.serviceSignals && report.serviceSignals.length > 0 ? (
          <section
            aria-labelledby="service-signals-heading"
            data-testid="service-signals-section"
            className="rounded-md border border-rule bg-surface p-5"
          >
            <h2
              id="service-signals-heading"
              className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
            >
              {messages["service.signals.title"] ?? "Đặc tính dịch vụ đã phát hiện"}
            </h2>
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {report.serviceSignals.map((signal) => (
                <li key={signal.id} className="border-l-2 border-rule pl-3">
                  <p className="font-semibold">{serviceSignalLabel(locale, signal.kind)}</p>
                  <p className="text-ink-soft">{signal.excerpt}</p>
                  <p className="mt-1 font-mono text-xs text-ink-soft">
                    {signal.sourceUrl} · {(signal.confidence * 100).toFixed(0)}%
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.licenseChecks && report.licenseChecks.length > 0 ? (
          <section
            aria-labelledby="license-checks-heading"
            data-testid="license-checks-section"
            className="rounded-md border border-rule bg-surface p-5"
          >
            <h2
              id="license-checks-heading"
              className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
            >
              {messages["license.checks.title"] ?? "Kiểm tra giấy phép"}
            </h2>
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {report.licenseChecks.map((check) => (
                <li key={check.id} className="border-l-2 border-gold pl-3">
                  <p className="font-semibold">
                    {licenseTypeLabel(locale, check.licenseType)} ·{" "}
                    {severityLabel(messages, check.severity)}
                  </p>
                  <p className="text-ink-soft">{check.rationale}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {messages["finding.recommended_action"] ?? "Hành động đề xuất"}:{" "}
                    {check.recommendedAction}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.assetInventory && report.assetInventory.assets.length > 0 ? (
          <section
            aria-labelledby="asset-inventory-heading"
            data-testid="asset-inventory-section"
            className="rounded-md border border-rule bg-surface p-5"
          >
            <h2
              id="asset-inventory-heading"
              className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
            >
              {messages["asset.inventory.title"] ?? "Inventory tài sản số"}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              {messages["asset.inventory.summary"] ?? "Tài sản được site tham chiếu"}:{" "}
              {report.assetInventory.summary.total} ·{" "}
              {messages["asset.inventory.flagged"] ?? "Cần kiểm tra license"}:{" "}
              {report.assetInventory.summary.flagged}
            </p>
            {messages["asset.inventory.scope"] ? (
              <p className="mt-1 text-xs italic text-ink-soft">
                {messages["asset.inventory.scope"]}
              </p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-3 text-xs">
              {report.assetInventory.assets.slice(0, 25).map((asset) => (
                <li
                  key={asset.id}
                  className="border-t border-rule pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="font-semibold uppercase tracking-wider">
                    {asset.kind} · {asset.licenseEvidence}
                  </p>
                  <p className="mt-1 break-all font-mono text-ink">{asset.url}</p>
                  <p className="mt-1 text-ink-soft">
                    {asset.sourceUrl} · {(asset.confidence * 100).toFixed(0)}%
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="findings-heading" className="flex flex-col gap-4">
          <h2
            id="findings-heading"
            className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
          >
            {totalFindings > 0
              ? locale === "vi"
                ? "Phát hiện"
                : "Findings"
              : locale === "vi"
                ? "Không có phát hiện đáng kể"
                : "No significant findings"}
          </h2>

          {totalFindings > 0 && visibleTabs.length > 0 ? (
            <div
              data-testid="findings-summary"
              className="flex flex-col gap-4 rounded-md border border-rule bg-surface p-5 sm:flex-row sm:items-center sm:gap-6"
            >
              <FindingsDonut total={totalFindings} segments={visibleTabs.map((tab) => ({
                severity: tab.severity,
                count: tab.findings.length,
                accentClass: severityAccentClass(tab.severity),
              }))} />
              <ul className="flex flex-col gap-2 text-sm">
                {visibleTabs.map((tab) => {
                  const pct = Math.round((tab.findings.length / totalFindings) * 100);
                  const dotBg = severityAccentClass(tab.severity)
                    .split(" ")
                    .find((c) => c.startsWith("bg-")) ?? "bg-ink-soft";
                  return (
                    <li
                      key={tab.severity}
                      data-testid={`findings-summary-legend-${tab.severity}`}
                      className="flex items-center gap-2"
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${dotBg}`}
                      />
                      <span className="text-ink">
                        {severityLabel(messages, tab.severity)}
                      </span>
                      <span className="font-mono text-ink-soft">{tab.findings.length}</span>
                      <span className="font-mono text-ink-soft">({pct}%)</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {visibleTabs.length > 0 && activeTab ? (
            <>
              <div
                role="tablist"
                aria-label={locale === "vi" ? "Phát hiện theo mức độ" : "Findings by severity"}
                data-testid="findings-tabs"
                className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule"
              >
                {visibleTabs.map((tab) => {
                  const isActive = tab.severity === activeTab;
                  const accent = severityAccentClass(tab.severity);
                  return (
                    <button
                      key={tab.severity}
                      type="button"
                      role="tab"
                      id={`tab-${tab.severity}`}
                      aria-selected={isActive}
                      aria-controls={`tabpanel-${tab.severity}`}
                      data-testid={`findings-tab-${tab.severity}`}
                      onClick={() => setActiveTab(tab.severity)}
                      className={`inline-flex items-center gap-2 border-b-2 pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                        isActive
                          ? `${accent}`
                          : "border-transparent text-ink-soft hover:text-ink hover:border-ink/20"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${
                          isActive ? accent.split(" ").find((c) => c.startsWith("bg-")) ?? "" : "bg-ink/30"
                        }`}
                      />
                      <span>{severityLabel(messages, tab.severity)}</span>
                      <span
                        data-testid={`findings-tab-count-${tab.severity}`}
                        className="rounded-full bg-surface px-2 py-0.5 font-mono text-xs"
                      >
                        {tab.findings.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {visibleTabs.map((tab) => {
                const isActive = tab.severity === activeTab;
                if (!isActive) return null;
                return (
                  <div
                    key={tab.severity}
                    role="tabpanel"
                    id={`tabpanel-${tab.severity}`}
                    aria-labelledby={`tab-${tab.severity}`}
                    data-testid={`findings-tabpanel-${tab.severity}`}
                    className="flex flex-col gap-4"
                  >
                    {tab.findings.length === 0 ? (
                      <p className="text-sm italic text-ink-soft">
                        {locale === "vi"
                          ? "Không có phát hiện ở mức này."
                          : "No findings at this level."}
                      </p>
                    ) : (
                      tab.findings.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          messages={messages}
                          locale={locale}
                        />
                      ))
                    )}
                  </div>
                );
              })}
            </>
          ) : null}
        </section>

        <p
          data-testid="report-disclaimer"
          className="border-l-2 border-gold pl-3 text-xs italic text-ink-soft"
        >
          {messages.disclaimer}
        </p>

        <p className="text-xs text-ink-soft">
          {messages["expiry.label"]} {formatDate(report.expiresAt, locale)}
        </p>
      </div>

      <footer className="mx-auto flex max-w-4xl flex-col gap-1 border-t border-rule px-6 py-6 text-xs text-ink-soft md:flex-row md:items-center md:justify-between">
        <span>{messages["footer.disclosure"]}</span>
        <span>{messages["footer.version"]}</span>
      </footer>
    </section>
  );
};

interface FindingsDonutProps {
  readonly total: number;
  readonly segments: readonly {
    readonly severity: Severity;
    readonly count: number;
    readonly accentClass: string;
  }[];
}

/**
 * Inline SVG donut. Decorative (the legend below conveys the same data in
 * text), so marked aria-hidden. Each visible severity is one stroke-dasharray
 * segment on a single circle; segments are rotated to abut each other.
 */
const FindingsDonut = ({ total, segments }: FindingsDonutProps) => {
  const RADIUS = 40;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  let consumed = 0;
  const arcs = segments.map((segment) => {
    const length = total > 0 ? (segment.count / total) * CIRCUMFERENCE : 0;
    const strokeClass =
      segment.accentClass.split(" ").find((c) => c.startsWith("bg-"))?.replace(/^bg-/, "stroke-") ??
      "stroke-rule";
    const arc = {
      key: segment.severity,
      strokeClass,
      length,
      gap: CIRCUMFERENCE - length,
      dashOffset: -consumed,
    };
    consumed += length;
    return arc;
  });
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="12" className="stroke-rule" />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth="12"
            strokeDasharray={`${arc.length} ${arc.gap}`}
            strokeDashoffset={arc.dashOffset}
            transform="rotate(-90 50 50)"
            className={arc.strokeClass}
          />
        ))}
      </svg>
      <span
        data-testid="findings-summary-total"
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center font-serif text-2xl font-semibold tabular-nums"
      >
        {total}
      </span>
    </div>
  );
};

interface FindingCardProps {
  readonly finding: ReportFindingCard;
  readonly messages: ReportMessages;
  readonly locale: "vi" | "en";
}

const FindingCard = ({ finding, messages, locale }: FindingCardProps) => {
  const citation = finding.citations[0];
  const applicabilityLabel =
    finding.applicability === "current"
      ? messages["finding.applicability.current"]
      : messages["finding.applicability.upcoming"];
  return (
    <article
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-applicability={finding.applicability}
      className={`rounded-md border border-rule border-l-4 bg-surface p-5 ${severityCardClass(finding.severity)}`}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid={`severity-badge-${finding.id}`}
            className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${severityBadgeClass(finding.severity)}`}
          >
            {severityLabel(messages, finding.severity)}
          </span>
          <span className="text-xs uppercase tracking-wider text-ink-soft">
            {applicabilityLabel}
          </span>
        </div>
        <p className="font-serif text-lg font-semibold leading-snug">{finding.rationale}</p>
      </header>

      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wider text-ink-soft">
            {messages["finding.confidence"]}
          </dt>
          <dd>
            <span data-testid={`confidence-${finding.id}`} className="font-mono text-sm">
              {(finding.confidence * 100).toFixed(0)}%
            </span>
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wider text-ink-soft">
            {messages["finding.evidence"]}
          </dt>
          <dd className="font-mono text-xs text-ink">{finding.evidenceExcerpt}</dd>
        </div>

        {citation ? (
          <div className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-wider text-ink-soft">
              {messages["finding.legal_excerpt"]}
            </dt>
            <dd className="italic text-ink">"{citation.excerpt}"</dd>
            <dt className="mt-2 text-xs uppercase tracking-wider text-ink-soft">
              {messages["finding.source"]}
            </dt>
            <dd className="text-sm">{citation.source}</dd>
            <dt className="mt-2 text-xs uppercase tracking-wider text-ink-soft">
              {messages["finding.retrieved_at"]}
            </dt>
            <dd className="text-sm">{formatDate(citation.retrievedAt, locale)}</dd>
            {/* TODO: re-enable "Xem văn bản đầy đủ" link when vbpl.vn link 404 is fixed.
                The current behavior intentionally hides outbound links and shows
                a fallback label so users are never sent to a broken source.
                Revert by restoring the `isApprovedCitationUrl(citation.url) ? <a> : <p>` block. */}
            <p
              data-testid={`provision-link-unavailable-${finding.id}`}
              className="mt-3 inline-flex w-fit rounded-sm border border-rule px-3 py-1 text-xs italic text-ink-soft"
            >
              {messages["finding.source_link_unavailable"]}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wider text-ink-soft">
            {messages["finding.recommended_action"]}
          </dt>
          <dd className="text-sm">{finding.recommendedAction}</dd>
        </div>
      </dl>
    </article>
  );
};
