import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportView, type ReportPayload, type ReportMessages } from "./report-view";

const viMessages: ReportMessages = {
  brand: "SafeLaunch",
  "locale.switch": "VI / EN",
  title: "Báo cáo tuân thủ",
  "ai.badge": "Báo cáo này có sự hỗ trợ của AI và được xem xét thủ công.",
  "coverage.label": "Phạm vi quét",
  "coverage.fetched": "Đã quét",
  "coverage.failed": "Không thể quét",
  "coverage.skipped": "Bỏ qua",
  "status.high_risk": "Phát hiện vi phạm nghiêm trọng",
  "status.needs_review": "Cần chuyên gia xem xét",
  "status.no_significant_risk": "Không phát hiện vấn đề đáng kể",
  "finding.severity.high": "Nghiêm trọng",
  "finding.severity.review": "Cần xem xét",
  "finding.severity.pass": "Đạt",
  "finding.applicability.current": "Hiện tại",
  "finding.applicability.upcoming": "Sắp tới",
  "finding.confidence": "Độ tin cậy",
  "finding.recommended_action": "Hành động đề xuất",
  "finding.evidence": "Trích dẫn từ trang",
  "finding.legal_excerpt": "Trích dẫn pháp lý",
  "finding.source": "Nguồn",
  "finding.retrieved_at": "Ngày trích dẫn",
  "finding.provision_link": "Xem văn bản đầy đủ",
  "upcoming.banner": "Có yêu cầu mới sẽ có hiệu lực vào",
  "expiry.label": "Báo cáo hết hạn vào",
  disclaimer:
    "Báo cáo này là tín hiệu tham khảo, không phải tư vấn pháp lý. Vui lòng tham vấn luật sư có chứng chỉ cho quyết định cuối cùng.",
  "footer.disclosure": "Báo cáo này là tín hiệu tham khảo, không phải tư vấn pháp lý.",
  "footer.version": "v0.1 · SafeLaunch",
};

const enMessages: ReportMessages = {
  brand: "SafeLaunch",
  "locale.switch": "VI / EN",
  title: "Compliance report",
  "ai.badge": "This report is AI-assisted and human-reviewed.",
  "coverage.label": "Scan coverage",
  "coverage.fetched": "Fetched",
  "coverage.failed": "Failed",
  "coverage.skipped": "Skipped",
  "status.high_risk": "Serious findings detected",
  "status.needs_review": "Requires expert review",
  "status.no_significant_risk": "No significant risk detected",
  "finding.severity.high": "High",
  "finding.severity.review": "Review",
  "finding.severity.pass": "Pass",
  "finding.applicability.current": "Current",
  "finding.applicability.upcoming": "Upcoming",
  "finding.confidence": "Confidence",
  "finding.recommended_action": "Recommended action",
  "finding.evidence": "Website excerpt",
  "finding.legal_excerpt": "Legal excerpt",
  "finding.source": "Source",
  "finding.retrieved_at": "Retrieved",
  "finding.provision_link": "Read the full provision",
  "upcoming.banner": "A new requirement takes effect on",
  "expiry.label": "Report expires on",
  disclaimer:
    "This report is a compliance signal, not legal advice. Please consult a licensed attorney for the final decision.",
  "footer.disclosure": "This report is a compliance signal, not legal advice.",
  "footer.version": "v0.1 · SafeLaunch",
};

const baseReport: ReportPayload = {
  scanId: "scan-1",
  jurisdiction: "VN",
  category: "online_game",
  status: "needs_review",
  coverage: { fetched: ["homepage", "about"], failed: [], skipped: [] },
  findings: [],
  generatedAt: "2026-07-29T10:00:00.000Z",
  expiresAt: "2026-08-05T10:00:00.000Z",
  rubricVersion: "vn-mvp-v1",
};

describe("ReportView", () => {
  it("shows failed coverage and never displays a compliance approval", () => {
    const partialReport: ReportPayload = {
      ...baseReport,
      status: "needs_review",
      coverage: {
        fetched: ["homepage"],
        failed: ["privacy"],
        skipped: [],
      },
    };
    render(<ReportView report={partialReport} locale="vi" messages={viMessages} />);
    expect(screen.getByText(/không thể quét.*privacy/i)).toBeVisible();
    // The view must never display a "fully compliant" / "cleared to launch" badge for a partial report.
    expect(screen.queryByText(/tuân thủ hoàn toàn/i)).toBeNull();
    expect(screen.queryByText(/được phép phát hành/i)).toBeNull();
  });

  it("renders the AI-assisted badge so users know the source is not a lawyer", () => {
    render(<ReportView report={baseReport} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("report-ai-badge")).toBeInTheDocument();
  });

  it("displays the non-advice disclosure on the report view", () => {
    render(<ReportView report={baseReport} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("report-disclaimer")).toBeInTheDocument();
  });

  it("separates current findings from upcoming findings", () => {
    const mixedReport: ReportPayload = {
      ...baseReport,
      findings: [
        {
          id: "f-current",
          severity: "high",
          rationale: "Vi phạm hiện tại.",
          confidence: 0.95,
          evidenceIds: ["ev-1"],
          citations: [
            {
              provisionId: "p-1",
              source: "Nghị định 72/2013",
              url: "https://vbpl.vn/x",
              retrievedAt: "2025-01-01T00:00:00.000Z",
              excerpt: "Điều 1. Quy định về p-1.",
            },
          ],
          recommendedAction: "Gỡ bỏ nội dung.",
          applicability: "current",
          evidenceExcerpt: "Trích dẫn từ website.",
          upcomingEffectiveAt: null,
        },
        {
          id: "f-upcoming",
          severity: "review",
          rationale: "Yêu cầu mới.",
          confidence: 0.85,
          evidenceIds: ["ev-2"],
          citations: [
            {
              provisionId: "p-2",
              source: "Luật 2025",
              url: "https://vbpl.vn/y",
              retrievedAt: "2025-01-01T00:00:00.000Z",
              excerpt: "Điều 2.",
            },
          ],
          recommendedAction: "Theo dõi ngày hiệu lực.",
          applicability: "upcoming",
          evidenceExcerpt: "Không có.",
          upcomingEffectiveAt: "2030-01-01T00:00:00.000Z",
        },
      ],
    };
    render(<ReportView report={mixedReport} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-current-heading")).toBeInTheDocument();
    expect(screen.getByTestId("findings-upcoming-heading")).toBeInTheDocument();
    expect(screen.getByTestId("upcoming-banner-label")).toBeInTheDocument();
    expect(screen.getByText(/2030/)).toBeInTheDocument();
  });

  it("renders English copy when the locale is 'en'", () => {
    render(<ReportView report={baseReport} locale="en" messages={enMessages} />);
    expect(screen.getByText("Compliance report")).toBeInTheDocument();
    expect(screen.getByText(/Scan coverage/i)).toBeInTheDocument();
  });
});
