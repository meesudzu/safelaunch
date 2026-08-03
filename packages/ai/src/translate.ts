import type { OverallReportStatus, ReportFinding, ScanCoverage } from "@safelaunch/contracts";

/**
 * Bilingual report translator.
 *
 * The translator is given a Vietnamese `ReportPayload` and a `Translator`
 * function. It returns a bilingual report with the same machine fields
 * (scanId, jurisdiction, category, status, coverage, findings[].severity,
 * findings[].evidenceIds, findings[].citations, generatedAt) and
 * human-readable fields translated per locale.
 *
 * If the translator throws, the original Vietnamese text is reused for the
 * English locale so the report never carries an un-translated placeholder.
 */

export interface Translator {
  (input: { text: string; locale: "vi" | "en" }): Promise<string>;
}

export interface ReportPayload {
  readonly scanId: string;
  readonly jurisdiction: string;
  readonly category: "online_game" | "electronic_press" | "digital_entertainment";
  readonly status: OverallReportStatus;
  readonly coverage: ScanCoverage;
  readonly findings: readonly ReportFinding[];
  readonly generatedAt: string;
}

export interface LocalizedReport extends ReportPayload {
  readonly summaryLabel: string;
}

export interface BilingualReport {
  readonly vi: LocalizedReport;
  readonly en: LocalizedReport;
  readonly summaryLabel: string;
}

const localizeFinding = async (
  finding: ReportFinding,
  translator: Translator,
  locale: "vi" | "en",
): Promise<ReportFinding> => {
  const rationale = await safeTranslate(finding.rationale, translator, locale);
  const recommendedAction = await safeTranslate(finding.recommendedAction, translator, locale);
  return {
    ...finding,
    rationale,
    recommendedAction,
  };
};

const safeTranslate = async (
  text: string,
  translator: Translator,
  locale: "vi" | "en",
): Promise<string> => {
  try {
    return await translator({ text, locale });
  } catch {
    return text;
  }
};

const localizeReport = async (
  payload: ReportPayload,
  translator: Translator,
  locale: "vi" | "en",
  summaryLabel: string,
): Promise<LocalizedReport> => {
  const findings: ReportFinding[] = [];
  for (const finding of payload.findings) {
    findings.push(await localizeFinding(finding, translator, locale));
  }
  return {
    scanId: payload.scanId,
    jurisdiction: payload.jurisdiction,
    category: payload.category,
    status: payload.status,
    coverage: payload.coverage,
    findings,
    generatedAt: payload.generatedAt,
    summaryLabel,
  };
};

export const translateReport = async (
  payload: ReportPayload,
  translator: Translator,
  options: { summaryLabel?: string } = {},
): Promise<BilingualReport> => {
  const summaryLabel = options.summaryLabel ?? "Trạng thái tổng thể";
  const enSummary = await safeTranslate(summaryLabel, translator, "en");
  const [vi, en] = await Promise.all([
    localizeReport(payload, translator, "vi", summaryLabel),
    localizeReport(payload, translator, "en", enSummary),
  ]);
  return { vi, en, summaryLabel };
};

/**
 * The machine-readable subset of a report — fields that must be byte-for-byte
 * identical across `vi` and `en`. Used by the invariant test.
 */
export interface MachineFields {
  scanId: string;
  jurisdiction: string;
  category: string;
  status: OverallReportStatus;
  coverage: ScanCoverage;
  findings: readonly ReportFinding[];
  generatedAt: string;
}

export const projectMachineFields = (payload: ReportPayload): MachineFields => ({
  scanId: payload.scanId,
  jurisdiction: payload.jurisdiction,
  category: payload.category,
  status: payload.status,
  coverage: payload.coverage,
  findings: payload.findings,
  generatedAt: payload.generatedAt,
});
