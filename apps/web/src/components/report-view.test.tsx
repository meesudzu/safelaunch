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
  "status.high_risk": "Phát hiện tín hiệu rủi ro cao",
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
  "service.signals.title": "Đặc tính dịch vụ đã phát hiện",
  "license.checks.title": "Kiểm tra giấy phép",
  "asset.inventory.title": "Inventory tài sản số",
  "asset.inventory.summary": "Tài sản được site tham chiếu",
  "asset.inventory.flagged": "Cần kiểm tra license",
  "asset.inventory.scope": "Phạm vi: font (ảnh/video/audio nằm ngoài phạm vi quét)",
  "finding.source_link_unavailable": "Liên kết nguồn không khả dụng",
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
  "status.high_risk": "High-risk signals detected",
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
  "service.signals.title": "Detected service characteristics",
  "license.checks.title": "License checks",
  "asset.inventory.title": "Digital asset inventory",
  "asset.inventory.summary": "Assets referenced by the site",
  "asset.inventory.flagged": "Assets requiring license review",
  "asset.inventory.scope": "Scope: fonts (images / video / audio are out of scan scope)",
  "finding.source_link_unavailable": "Source link unavailable",
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

describe("digital rights report sections", () => {
  it("renders service signals, license checks, and the digital asset inventory", () => {
    const report: ReportPayload = {
      ...baseReport,
      serviceSignals: [
        {
          id: "signal::ugc",
          kind: "ugc",
          observed: true,
          confidence: 0.9,
          sourceUrl: "https://example.com/community",
          excerpt: "Đăng bài",
          evidenceId: "signal::ugc",
        },
      ],
      licenseChecks: [
        {
          id: "license::social_network",
          licenseType: "social_network",
          status: "required_unavailable",
          severity: "high",
          rationale: "Chưa xác minh giấy phép mạng xã hội.",
          confidence: 0.55,
          evidenceIds: ["signal::ugc"],
          citations: [],
          recommendedAction: "Kiểm tra hồ sơ giấy phép.",
        },
      ],
      assetInventory: {
        summary: { total: 1, byKind: { image: 1 }, flagged: 1 },
        assets: [
          {
            id: "asset::image::1",
            kind: "image",
            url: "https://cdn.example.com/hero.jpg",
            host: "cdn.example.com",
            sourceUrl: "https://example.com/",
            contentType: "image/jpeg",
            sha256: "a".repeat(64),
            status: "fetched",
            licenseEvidence: "no_license_evidence",
            licenseExcerpt: null,
            confidence: 0.55,
          },
        ],
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("service-signals-section")).toBeInTheDocument();
    expect(screen.getByText("Đăng bài")).toBeVisible();
    expect(screen.getByTestId("license-checks-section")).toBeInTheDocument();
    expect(screen.getByTestId("asset-inventory-section")).toBeInTheDocument();
    expect(screen.getByText("https://cdn.example.com/hero.jpg")).toBeVisible();
  });
});

describe("citation link hardening", () => {
  it("renders the provision link when the citation URL host is in the approved list", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        {
          id: "f-vbpl",
          severity: "high",
          rationale: "Citation test.",
          confidence: 0.9,
          evidenceIds: ["ev-1"],
          citations: [
            {
              provisionId: "p-vbpl",
              source: "VBPL",
              url: "https://vbpl.vn/tim-kiem?SearchIn=all&q=test",
              retrievedAt: "2026-01-01T00:00:00.000Z",
              excerpt: "Excerpt.",
            },
          ],
          recommendedAction: "Xem.",
          applicability: "current",
          evidenceExcerpt: "Excerpt.",
          upcomingEffectiveAt: null,
        },
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("provision-link-f-vbpl")).toHaveAttribute(
      "href",
      "https://vbpl.vn/tim-kiem?SearchIn=all&q=test",
    );
    expect(screen.queryByTestId("provision-link-unavailable-f-vbpl")).toBeNull();
  });

  it("renders a text fallback when the citation URL host is not approved", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        {
          id: "f-evil",
          severity: "high",
          rationale: "Citation test.",
          confidence: 0.9,
          evidenceIds: ["ev-1"],
          citations: [
            {
              provisionId: "p-evil",
              source: "Unknown source",
              url: "https://vbpl.vn.evil.example/x",
              retrievedAt: "2026-01-01T00:00:00.000Z",
              excerpt: "Excerpt.",
            },
          ],
          recommendedAction: "Xem.",
          applicability: "current",
          evidenceExcerpt: "Excerpt.",
          upcomingEffectiveAt: null,
        },
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("provision-link-f-evil")).toBeNull();
    expect(screen.getByTestId("provision-link-unavailable-f-evil")).toHaveTextContent(
      "Liên kết nguồn không khả dụng",
    );
  });

  it("renders a text fallback when the citation URL is malformed", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        {
          id: "f-bad",
          severity: "high",
          rationale: "Citation test.",
          confidence: 0.9,
          evidenceIds: ["ev-1"],
          citations: [
            {
              provisionId: "p-bad",
              source: "Bad URL",
              url: "not a url",
              retrievedAt: "2026-01-01T00:00:00.000Z",
              excerpt: "Excerpt.",
            },
          ],
          recommendedAction: "Xem.",
          applicability: "current",
          evidenceExcerpt: "Excerpt.",
          upcomingEffectiveAt: null,
        },
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("provision-link-f-bad")).toBeNull();
    expect(screen.getByTestId("provision-link-unavailable-f-bad")).toBeVisible();
  });
});
