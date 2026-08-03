import {
  ReportView,
  type ReportPayload,
  type ReportMessages,
} from "../../../../components/report-view";
import reportVi from "../../../../messages/report-vi.json";
import reportEn from "../../../../messages/report-en.json";
import { createApiClient, type ReportPayloadDto } from "../../../../lib/api-client";
import type { Locale } from "../../../../lib/locale";

const messagesFor = (locale: Locale): ReportMessages => (locale === "vi" ? reportVi : reportEn);

const toReportPayload = (dto: ReportPayloadDto): ReportPayload => ({
  scanId: dto.scanId,
  jurisdiction: dto.jurisdiction,
  category: dto.category,
  status: dto.status,
  coverage: dto.coverage,
  findings: dto.findings.map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    rationale: finding.rationale,
    confidence: finding.confidence,
    evidenceIds: finding.evidenceIds,
    citations: finding.citations,
    recommendedAction: finding.recommendedAction,
    applicability: finding.applicability,
    evidenceExcerpt: finding.evidenceExcerpt,
    upcomingEffectiveAt: finding.upcomingEffectiveAt,
  })),
  generatedAt: dto.generatedAt,
  expiresAt: dto.expiresAt,
  rubricVersion: dto.rubricVersion,
});

export default async function ReportPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (locale !== "vi" && locale !== "en") {
    return null;
  }
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });
  try {
    const dto = await client.getReport(token);
    const report = toReportPayload(dto);
    return (
      <main>
        <ReportView locale={locale} messages={messagesFor(locale)} report={report} />
      </main>
    );
  } catch (cause) {
    return (
      <main className="bg-bg text-ink font-sans">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="font-serif text-2xl font-semibold">
            {locale === "vi" ? "Không thể tải báo cáo" : "Report unavailable"}
          </h1>
          <p className="mt-3 text-sm text-ink-soft">
            {locale === "vi"
              ? "Báo cáo không khả dụng, đã hết hạn, hoặc liên kết không hợp lệ."
              : "The report is unavailable, expired, or the link is invalid."}
          </p>
          {cause instanceof Error ? (
            <p className="mt-3 text-xs text-ink-soft">{cause.message}</p>
          ) : null}
        </div>
      </main>
    );
  }
}
