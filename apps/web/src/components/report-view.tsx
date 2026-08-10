"use client";

import { useState } from "react";

import { isApprovedFontSourceUrl } from "../lib/citation-hosts";
import { ThemeToggle } from "./theme-toggle";

import type {
  AssetRightsSummary,
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
  readonly "font.license.verified_open": string;
  readonly "font.license.declared_open": string;
  readonly "font.license.requires_license_proof": string;
  readonly "font.license.unknown": string;
  readonly "font.license.conflicting": string;
  readonly "font.license.unavailable": string;
  readonly "font.family.files": string;
  readonly "font.family.unknown": string;
  readonly "font.family.open_details": string;
  readonly "font.family.confidence": string;
  readonly "font.variant.see_source": string;
  readonly "font.source_unavailable": string;
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
  readonly serviceSignals?: readonly ServiceSignal[] | undefined;
  readonly licenseChecks?: readonly LicenseCheck[] | undefined;
  readonly assetInventory?: {
    readonly assets: ReadonlyArray<{
      readonly id: string;
      readonly kind: import("@safelaunch/contracts").DigitalAssetKind;
      readonly url: string;
      readonly host: string;
      readonly sourceUrl: string;
      readonly contentType: string | null;
      readonly sha256: string | null;
      readonly status: "fetched" | "inaccessible" | "blocked";
      readonly licenseEvidence: import("@safelaunch/contracts").AssetLicenseEvidence;
      readonly licenseExcerpt: string | null;
      readonly confidence: number;
      readonly fontInfo?: import("@safelaunch/contracts").FontInfo | null;
      readonly fontLicense?: import("@safelaunch/contracts").FontLicenseAssessment | null;
    }>;
    readonly summary: AssetRightsSummary;
  };
  readonly fontInventory?: ReportFontInventoryView | undefined;
}

export type ReportFontLicenseStatusView =
  | "verified_open"
  | "declared_open"
  | "requires_license_proof"
  | "unknown"
  | "conflicting"
  | "unavailable";

export interface ReportFontVariantView {
  readonly assetId: string;
  readonly url: string;
  readonly format: string | null;
  readonly postscriptName: string | null;
  readonly subfamilyName: string | null;
  readonly version: string | null;
  readonly fileSha256: string | null;
  readonly status: "fetched" | "inaccessible" | "blocked";
  readonly licenseEvidence: string;
}

export interface ReportFontFamilyGroupView {
  readonly id: string;
  readonly family: string;
  readonly kind?: "font" | undefined;
  readonly host: string;
  readonly hosts: readonly string[];
  readonly variants: readonly ReportFontVariantView[];
  readonly fontInfo: import("../lib/api-client").ReportFontInfoDto | null;
  readonly fontLicense: {
    readonly status: ReportFontLicenseStatusView;
    readonly reasonCodes: readonly string[];
    readonly confidence: number;
    readonly evidenceSources: ReadonlyArray<{
      provisionId: string;
      source: string;
      url: string;
      retrievedAt: string;
      excerpt: string;
    }>;
    readonly retrievedAt: string;
    readonly registryVersion: string | null;
  } | null;
  readonly confidence: number;
  readonly flagged: boolean;
  readonly citationCount: number;
}

export interface ReportFontInventoryView {
  readonly groups: readonly ReportFontFamilyGroupView[];
  readonly totals: { families: number; files: number; flagged: number };
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

const severityActiveTabClass = (severity: Severity): string => {
  switch (severity) {
    case "high":
      return "border-error bg-surface text-error";
    case "review":
      return "border-gold bg-surface text-gold";
    case "pass":
      return "border-success bg-surface text-success";
  }
};

const fontLicenseBadgeClass = (status: ReportFontLicenseStatusView): string => {
  switch (status) {
    case "verified_open":
      return "border-success text-success bg-success/10";
    case "declared_open":
      return "border-info text-info bg-info/10";
    case "requires_license_proof":
      return "border-gold text-ink bg-gold/10";
    case "unknown":
      return "border-ink-soft text-ink-soft bg-ink-soft/10";
    case "conflicting":
      return "border-error text-error bg-error/10";
    case "unavailable":
      return "border-ink-soft text-ink-soft bg-ink-soft/10";
  }
};

const fontLicenseLabel = (
  messages: ReportMessages,
  status: ReportFontLicenseStatusView,
): string => {
  switch (status) {
    case "verified_open":
      return messages["font.license.verified_open"];
    case "declared_open":
      return messages["font.license.declared_open"];
    case "requires_license_proof":
      return messages["font.license.requires_license_proof"];
    case "unknown":
      return messages["font.license.unknown"];
    case "conflicting":
      return messages["font.license.conflicting"];
    case "unavailable":
      return messages["font.license.unavailable"];
  }
};

const fontLicenseReasonCodes = (codes: readonly string[]): string => codes.join(", ");

const statusBannerClass = (status: OverallReportStatus): string => {
  switch (status) {
    case "high_risk":
      return "border-error bg-bg text-error";
    case "needs_review":
      return "border-gold bg-bg text-gold";
    case "no_significant_risk":
      return "border-success bg-bg text-success";
  }
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
  readonly localeHref?: string;
  readonly messages: ReportMessages;
  readonly report: ReportPayload;
}

export const ReportView = ({ locale, localeHref, messages, report }: ReportViewProps) => {
  const fetchedPages = report.coverage.fetched ?? [];
  const failedPages = report.coverage.failed ?? [];
  const skippedPages = report.coverage.skipped ?? [];
  const isPartial = failedPages.length > 0;

  // Asset IDs whose kind is "font". Findings that point exclusively at a font
  // asset duplicate the data already shown in the KIỂM TRA FONT (font
  // inventory) section, so we hide them from the findings tabs to avoid
  // rendering the same compliance signal twice. The raw findings are still
  // available in `report.findings` and the API response is unchanged — we
  // only narrow the view-layer filter here. Mixed-evidence findings
  // (font + non-font) are kept because the non-font evidence is not
  // surfaced anywhere else.
  const fontAssetIds = (() => {
    const ids = new Set<string>();
    for (const asset of report.assetInventory?.assets ?? []) {
      if (asset.kind === "font") ids.add(asset.id);
    }
    return ids;
  })();

  const isFontOnlyFinding = (f: ReportFindingCard): boolean =>
    f.evidenceIds.length > 0 && f.evidenceIds.every((id) => fontAssetIds.has(id));

  const findingsExcludingFonts = report.findings
    .filter((f) => !isFontOnlyFinding(f))
    .filter(
      (finding, index, findings) =>
        findings.findIndex((candidate) => candidate.id === finding.id) === index,
    );

  // Group findings by severity for the tab strip. Within a tab we keep the
  // current/upcoming order intact so the temporal signal is still visible
  // alongside the severity grouping.
  const sortedBySeverity = (sev: Severity): readonly ReportFindingCard[] => {
    const sameSeverity = findingsExcludingFonts.filter((f) => f.severity === sev);
    return [
      ...sameSeverity.filter((f) => f.applicability === "current"),
      ...sameSeverity.filter((f) => f.applicability === "upcoming"),
    ];
  };

  const allTabs = (["high", "review", "pass"] as const).map((sev) => ({
    severity: sev,
    findings: sortedBySeverity(sev),
  }));

  // Review tab stays visible when there are no non-font findings left in it
  // but the report still has a font inventory panel to show — otherwise the
  // moved-into-tab font inventory would silently disappear.
  const hasFontInventoryPanel =
    report.fontInventory !== undefined && report.fontInventory.groups.length > 0;

  const visibleTabs = allTabs.filter(
    (t) => t.findings.length > 0 || (t.severity === "review" && hasFontInventoryPanel),
  );

  const defaultTab: Severity | null =
    visibleTabs.find((t) => t.severity === "high")?.severity ?? visibleTabs[0]?.severity ?? null;

  const [activeTab, setActiveTab] = useState<Severity | null>(defaultTab);

  const totalFindings = findingsExcludingFonts.length;
  const coverageTotal = fetchedPages.length + failedPages.length + skippedPages.length;
  const coveragePercent =
    coverageTotal > 0 ? Math.round((fetchedPages.length / coverageTotal) * 100) : 0;

  return (
    <section
      aria-labelledby="report-title"
      data-locale={locale}
      data-coverage={isPartial ? "partial" : "complete"}
      className="technical-grid min-h-screen bg-bg text-ink font-sans antialiased"
    >
      <header className="sticky top-0 z-50 border-b border-rule bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 md:px-8">
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
              href={localeHref ?? `/${locale === "vi" ? "en" : "vi"}`}
              className="border border-rule px-3 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-ink-soft transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {messages["locale.switch"]}
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] grid-cols-1 gap-8 px-5 py-12 md:px-8 lg:grid-cols-12 lg:py-16">
        <div className="flex flex-col gap-3 lg:col-span-12">
          <p
            data-testid="report-ai-badge"
            className="inline-flex w-fit items-center gap-2 border border-rule bg-surface px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent"
          >
            <span aria-hidden="true">AI</span>
            <span>{messages["ai.badge"]}</span>
          </p>
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <h1
              id="report-title"
              className="shrink-0 font-serif text-4xl font-extrabold leading-tight tracking-tight md:text-5xl"
            >
              {messages.title}
            </h1>
            <div
              data-testid="report-status-banner"
              data-status={report.status}
              className={`flex items-center gap-4 border-l-4 px-5 py-2 md:ml-auto ${statusBannerClass(report.status)}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="none">
                <path d="M12 3 2.5 20h19L12 3Z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="currentColor" />
              </svg>
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                  {locale === "vi" ? "Tình trạng tổng" : "Overall status"}
                </p>
                <p className="mt-0.5 text-lg font-extrabold uppercase tracking-tight">
                  {statusLabel(messages, report.status)}
                </p>
              </div>
              <p className="hidden border-l border-rule pl-4 font-mono text-xs opacity-70 lg:block">
                {formatDate(report.generatedAt, locale)} · {report.jurisdiction} ·{" "}
                {report.rubricVersion}
              </p>
            </div>
          </div>
        </div>

        <aside
          aria-labelledby="coverage-heading"
          className="order-1 flex self-start flex-col gap-6 lg:col-span-4 lg:col-start-1 lg:row-start-2 lg:sticky lg:top-24"
        >
          {totalFindings > 0 ? (
            <div data-testid="findings-summary" className="border border-rule bg-bg p-7">
              <div className="flex items-end justify-between border-b border-rule pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                  {locale === "vi" ? "Tổng phát hiện" : "Total findings"}
                </p>
                <span
                  data-testid="findings-summary-total"
                  className="font-serif text-6xl font-bold leading-none text-accent tabular-nums"
                >
                  {totalFindings}
                </span>
              </div>
              <div
                data-testid="risk-distribution-chart"
                role="img"
                aria-label={allTabs
                  .map((tab) => `${severityLabel(messages, tab.severity)}: ${tab.findings.length}`)
                  .join("; ")}
                className="mt-6 flex h-2 overflow-hidden bg-rule"
              >
                {allTabs.map((tab) => (
                  <span
                    key={tab.severity}
                    className={
                      severityAccentClass(tab.severity)
                        .split(" ")
                        .find((className) => className.startsWith("bg-")) ?? "bg-rule"
                    }
                    style={{ width: `${(tab.findings.length / totalFindings) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="mt-5 flex flex-col gap-4 font-mono text-sm">
                {allTabs.map((tab) => {
                  const dotBg =
                    severityAccentClass(tab.severity)
                      .split(" ")
                      .find((className) => className.startsWith("bg-")) ?? "bg-ink-soft";
                  return (
                    <li
                      key={tab.severity}
                      data-testid={`findings-summary-legend-${tab.severity}`}
                      className="flex items-center justify-between"
                    >
                      <span className="flex items-center gap-3">
                        <span className={`block size-2 ${dotBg}`} aria-hidden="true" />
                        <span className="uppercase tracking-wide">
                          {severityLabel(messages, tab.severity)}
                        </span>
                      </span>
                      <strong className="tabular-nums">{tab.findings.length}</strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <details
            data-testid="coverage-details"
            className="group border border-rule bg-bg p-7"
            open={isPartial}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
              <span id="coverage-heading">{messages["coverage.label"]}</span>
              <span className="font-mono text-xs font-normal text-ink-soft">
                {fetchedPages.length}/{coverageTotal}
              </span>
            </summary>
            <div
              data-testid="coverage-chart"
              role="img"
              aria-label={`${messages["coverage.fetched"]}: ${coveragePercent}%`}
              className="mt-4 h-1 overflow-hidden bg-rule"
            >
              <span className="block h-full bg-success" style={{ width: `${coveragePercent}%` }} />
            </div>
            <ul className="mt-5 flex max-h-72 flex-col gap-4 overflow-auto border-t border-rule pt-5 font-mono text-sm">
              {fetchedPages.map((page) => (
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
              {skippedPages.map((page) => (
                <li key={`skipped-${page}`} className="flex gap-2 text-ink-soft">
                  <span aria-hidden="true">·</span>
                  <span>
                    {messages["coverage.skipped"]}: {page}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          <p className="border border-rule bg-bg p-4 text-xs text-ink-soft">
            {messages["expiry.label"]} {formatDate(report.expiresAt, locale)}
          </p>
        </aside>

        {report.findings.some((f) => f.applicability === "upcoming") ? (
          <section
            aria-labelledby="upcoming-heading"
            data-testid="upcoming-banner"
            className="order-2 border border-gold bg-gold/10 p-5 lg:col-span-8 lg:col-start-5 lg:row-start-2"
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

        <section
          aria-labelledby="findings-heading"
          className="order-3 flex flex-col gap-4 lg:col-span-8 lg:col-start-5"
        >
          <h2
            id="findings-heading"
            className="font-mono text-sm font-semibold uppercase tracking-widest text-accent"
          >
            {totalFindings > 0
              ? locale === "vi"
                ? "Phát hiện"
                : "Findings"
              : locale === "vi"
                ? "Không có phát hiện đáng kể"
                : "No significant findings"}
          </h2>

          {visibleTabs.length > 0 && activeTab ? (
            <>
              <div
                role="tablist"
                aria-label={locale === "vi" ? "Phát hiện theo mức độ" : "Findings by severity"}
                data-testid="findings-tabs"
                className="grid w-full border-b border-rule bg-surface"
                style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
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
                      className={`inline-flex min-h-16 min-w-0 items-center justify-center gap-1 border-b-2 px-2 py-3 text-xs font-bold uppercase tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:min-h-20 sm:gap-3 sm:px-7 sm:py-5 sm:text-sm sm:tracking-wider ${
                        isActive
                          ? severityActiveTabClass(tab.severity)
                          : "border-transparent bg-transparent text-ink-soft hover:text-ink"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`hidden h-2 w-2 shrink-0 rounded-full sm:inline-block ${
                          isActive
                            ? (accent.split(" ").find((c) => c.startsWith("bg-")) ?? "")
                            : "bg-ink/30"
                        }`}
                      />
                      <span className="min-w-0 text-center leading-tight">
                        {severityLabel(messages, tab.severity)}
                      </span>
                      <span
                        data-testid={`findings-tab-count-${tab.severity}`}
                        className="bg-ink px-2 py-0.5 font-mono text-xs text-bg"
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
                    className="flex flex-col gap-6"
                  >
                    {tab.severity === "review" &&
                    report.fontInventory &&
                    report.fontInventory.groups.length > 0 ? (
                      <FontInventoryPanel
                        fontInventory={report.fontInventory}
                        messages={messages}
                        locale={locale}
                      />
                    ) : null}
                    {tab.findings.length === 0 &&
                    !(tab.severity === "review" && hasFontInventoryPanel) ? (
                      <p className="text-sm italic text-ink-soft">
                        {locale === "vi"
                          ? "Không có phát hiện ở mức này."
                          : "No findings at this level."}
                      </p>
                    ) : tab.findings.length > 0 ? (
                      tab.findings.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          messages={messages}
                          locale={locale}
                        />
                      ))
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : null}
        </section>

        <p
          data-testid="report-disclaimer"
          className="order-4 border-l-2 border-gold pl-3 text-sm italic text-ink-soft lg:col-span-8 lg:col-start-5"
        >
          {messages.disclaimer}
        </p>
      </div>

      <footer className="mx-auto flex max-w-[1480px] flex-col gap-1 border-t border-rule px-5 py-8 text-sm text-ink-soft md:flex-row md:items-center md:justify-between md:px-8">
        <span>{messages["footer.disclosure"]}</span>
        <span>{messages["footer.version"]}</span>
      </footer>
    </section>
  );
};

interface FindingCardProps {
  readonly finding: ReportFindingCard;
  readonly messages: ReportMessages;
  readonly locale: "vi" | "en";
}

const FindingCard = ({ finding, messages, locale }: FindingCardProps) => {
  const citation = finding.citations[0];
  const schemaFailure = finding.rationale.match(/\((Verifier schema violation):\s*([^)]+)\)/i);
  const readableRationale = finding.rationale
    .replace(/\s*\(Verifier schema violation:[^)]+\)/i, "")
    .trim();
  const [rationaleTitle, ...rationaleDetailParts] = readableRationale.split(". ");
  const rationaleDetail = rationaleDetailParts.join(". ");
  const applicabilityLabel =
    finding.applicability === "current"
      ? messages["finding.applicability.current"]
      : messages["finding.applicability.upcoming"];
  return (
    <article
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-applicability={finding.applicability}
      className={`border border-rule border-l-4 bg-bg transition-colors hover:bg-surface ${severityCardClass(finding.severity)}`}
    >
      <details className="group/finding">
        <summary className="flex min-h-20 cursor-pointer list-none flex-col items-stretch gap-4 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
          <span className="flex min-w-0 flex-col gap-3">
            <span className="flex flex-wrap items-center gap-2">
              <span
                data-testid={`severity-badge-${finding.id}`}
                className={`inline-flex items-center border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${severityBadgeClass(finding.severity)}`}
              >
                {severityLabel(messages, finding.severity)}
              </span>
              <span className="text-xs uppercase tracking-wider text-ink-soft">
                {applicabilityLabel}
              </span>
            </span>
            <span className="max-w-4xl font-serif text-base font-bold leading-snug md:text-lg">
              {rationaleTitle || finding.rationale}
            </span>
            {schemaFailure ? (
              <span className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-ink-soft">
                <span className="border border-rule bg-surface px-2 py-1 text-gold">
                  {schemaFailure[1]}
                </span>
                <span>{schemaFailure[2]}</span>
              </span>
            ) : null}
            {rationaleDetail ? (
              <span className="max-w-4xl text-sm leading-relaxed text-ink-soft">
                {rationaleDetail}
              </span>
            ) : null}
          </span>
          <span className="flex items-center justify-between gap-4 border-t border-rule pt-3 sm:justify-start sm:border-0 sm:pt-0">
            <span className="text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                {messages["finding.confidence"]}
              </span>
              <span
                data-testid={`confidence-${finding.id}`}
                className="mt-1 block font-mono text-sm text-error"
              >
                {(finding.confidence * 100).toFixed(0)}%
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl transition-transform group-open/finding:rotate-45"
            >
              +
            </span>
          </span>
        </summary>

        <div className="border-t border-rule p-5 md:p-6">
          <dl className="text-base">
            <div className="border border-rule bg-bg p-5">
              <dt className="text-xs uppercase tracking-wider text-ink-soft">
                {messages["finding.recommended_action"]}
              </dt>
              <dd className="mt-1 font-medium leading-relaxed">{finding.recommendedAction}</dd>
            </div>
          </dl>

          <details
            data-testid={`finding-evidence-${finding.id}`}
            className="group mt-5 border border-rule text-base open:bg-surface"
          >
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between px-5 font-semibold uppercase tracking-wider text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
              <span>{locale === "vi" ? "Bằng chứng và căn cứ" : "Evidence and legal basis"}</span>
              <span aria-hidden="true" className="text-lg leading-none group-open:rotate-45">
                +
              </span>
            </summary>
            <dl className="flex flex-col gap-4 border-t border-rule bg-bg p-5">
              <div className="flex flex-col gap-1">
                <dt className="text-xs uppercase tracking-wider text-ink-soft">
                  {messages["finding.evidence"]}
                </dt>
                <dd className="font-mono text-xs leading-relaxed text-ink">
                  {finding.evidenceExcerpt}
                </dd>
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
            </dl>
          </details>
        </div>
      </details>
    </article>
  );
};

interface FontInventoryPanelProps {
  readonly fontInventory: ReportFontInventoryView;
  readonly messages: ReportMessages;
  readonly locale: "vi" | "en";
}

/**
 * Renders the font audit as a standalone panel. Used inside the Cần xem xét
 * tab of the findings strip — the standalone "Kiểm tra font" section that
 * previously lived outside the tabs has been removed; the data still flows
 * from `report.fontInventory` and is unchanged.
 */
const FONT_IP_LAW_PROVISION_ID = "vn-ip-law-2022";

const FontInventoryPanel = ({ fontInventory, messages, locale }: FontInventoryPanelProps) => {
  const ipLawCitation = fontInventory.groups
    .flatMap((group) => group.fontLicense?.evidenceSources ?? [])
    .find((citation) => citation.provisionId === FONT_IP_LAW_PROVISION_ID);

  return (
    <section
      aria-labelledby="font-inventory-heading"
      data-testid="font-inventory-section"
      className="rounded-md border border-rule bg-surface p-5"
    >
      <h2
        id="font-inventory-heading"
        className="text-sm font-semibold uppercase tracking-wider text-ink-soft"
      >
        {locale === "vi" ? "Kiểm tra font" : "Font audit"}
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        {fontInventory.totals.families} {locale === "vi" ? "family" : "families"} ·{" "}
        {fontInventory.totals.files} {locale === "vi" ? "file" : "files"} ·{" "}
        {fontInventory.totals.flagged} {locale === "vi" ? "cần xem xét" : "need review"}
      </p>
      {ipLawCitation ? (
        <div data-testid="font-ip-law-citation" className="mt-3 border-l-2 border-rule pl-3">
          <p className="text-xs uppercase tracking-wider text-ink-soft">
            {messages["finding.legal_excerpt"]}
          </p>
          <blockquote className="mt-1 text-sm italic text-ink">
            &ldquo;{ipLawCitation.excerpt}&rdquo;
          </blockquote>
          <p className="mt-1 text-xs text-ink-soft">
            <a href={ipLawCitation.url} target="_blank" rel="noreferrer" className="underline">
              {ipLawCitation.source}
            </a>
            {" · "}
            {messages["finding.retrieved_at"]}: {formatDate(ipLawCitation.retrievedAt, locale)}
          </p>
        </div>
      ) : null}
      <ul className="mt-3 flex flex-col gap-3 text-xs">
        {fontInventory.groups.map((group) => (
          <li
            key={group.id}
            className="border-t border-rule pt-3 first:border-t-0 first:pt-0"
            data-testid="font-family-row"
          >
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold uppercase tracking-wider">{group.family}</span>
              {group.fontLicense ? (
                <span
                  data-testid="font-license-badge"
                  className={
                    "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                    fontLicenseBadgeClass(group.fontLicense.status)
                  }
                  title={fontLicenseReasonCodes(group.fontLicense.reasonCodes)}
                >
                  {fontLicenseLabel(messages, group.fontLicense.status)}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-sm border border-ink-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                  {messages["font.family.unknown"] ??
                    (locale === "vi" ? "Không xác định" : "Unknown")}
                </span>
              )}
            </p>
            <p className="mt-1 text-ink-soft">
              {group.variants.length}{" "}
              {messages["font.family.files"] ?? (locale === "vi" ? "file" : "files")} · {group.host}{" "}
              · {(group.confidence * 100).toFixed(0)}%
            </p>
            {group.fontInfo?.familyName ? (
              <p className="mt-1 text-ink-soft">
                {locale === "vi" ? "Tên trong file" : "File name"}: {group.fontInfo.familyName}
                {group.fontInfo.subfamilyName ? <> {group.fontInfo.subfamilyName}</> : null}
                {group.fontInfo.version ? <> · {group.fontInfo.version}</> : null}
              </p>
            ) : null}
            {group.fontLicense?.registryVersion ? (
              <p className="mt-1 text-ink-soft">
                {locale === "vi" ? "Registry" : "Registry"}: {group.fontLicense.registryVersion}
              </p>
            ) : null}
            {group.fontLicense?.evidenceSources.length ? (
              <p className="mt-1 break-all text-ink-soft">
                {group.fontLicense.evidenceSources.map((citation) => {
                  const approved = isApprovedFontSourceUrl(citation.url);
                  if (!approved) {
                    return (
                      <span key={citation.url} className="mr-2">
                        {messages["font.source_unavailable"] ??
                          (locale === "vi"
                            ? "Liên kết nguồn không khả dụng"
                            : "Source link unavailable")}
                      </span>
                    );
                  }
                  return (
                    <a
                      key={citation.url}
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-2 underline text-info"
                    >
                      {citation.source}
                    </a>
                  );
                })}
              </p>
            ) : null}
            <details className="mt-2">
              <summary className="cursor-pointer text-ink-soft">
                {messages["font.family.open_details"] ??
                  (locale === "vi" ? "Xem các biến thể" : "Show variants")}{" "}
                ({group.variants.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {group.variants.map((variant) => (
                  <li key={variant.assetId} className="border-l-2 border-rule pl-2">
                    <p className="font-mono text-ink break-all">{variant.url}</p>
                    <p className="text-ink-soft">
                      {variant.postscriptName ??
                        (locale === "vi" ? "Không rõ PostScript name" : "Unknown PostScript name")}
                      {variant.subfamilyName ? <> · {variant.subfamilyName}</> : null}
                      {variant.version ? <> · {variant.version}</> : null}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
};
