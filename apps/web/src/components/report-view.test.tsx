import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
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
  "font.license.verified_open": "verified",
  "font.license.declared_open": "declared",
  "font.license.requires_license_proof": "review",
  "font.license.unknown": "unknown",
  "font.license.conflicting": "conflicting",
  "font.license.unavailable": "unavailable",
  "font.family.files": "file",
  "font.family.unknown": "unknown",
  "font.family.open_details": "Xem",
  "font.family.confidence": "Tin cậy",
  "font.variant.see_source": "Nguồn",
  "font.source_unavailable": "Liên kết nguồn không khả dụng",
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
  "font.license.verified_open": "verified",
  "font.license.declared_open": "declared",
  "font.license.requires_license_proof": "review",
  "font.license.unknown": "unknown",
  "font.license.conflicting": "conflicting",
  "font.license.unavailable": "unavailable",
  "font.family.files": "files",
  "font.family.unknown": "unknown",
  "font.family.open_details": "Show variants",
  "font.family.confidence": "Confidence",
  "font.variant.see_source": "See source",
  "font.source_unavailable": "Source link unavailable",
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

type FindingSeed = {
  readonly id: string;
  readonly severity: "high" | "review" | "pass";
  readonly applicability: "current" | "upcoming";
};

const buildFinding = ({ id, severity, applicability }: FindingSeed) => ({
  id,
  severity,
  rationale: `Rationale for ${id}.`,
  confidence: 0.9,
  evidenceIds: [`ev-${id}`],
  citations: [
    {
      provisionId: `p-${id}`,
      source: "VBPL",
      url: "https://vbpl.vn/tim-kiem?SearchIn=all&q=test",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      excerpt: "Excerpt.",
    },
  ],
  recommendedAction: "Xem.",
  applicability,
  evidenceExcerpt: "Excerpt.",
  upcomingEffectiveAt: applicability === "upcoming" ? "2030-01-01T00:00:00.000Z" : null,
});

describe("ReportView", () => {
  it("makes the brand and locale controls navigable", () => {
    render(
      <ReportView
        report={baseReport}
        locale="vi"
        localeHref="/en/report/report-token"
        messages={viMessages}
      />,
    );
    expect(screen.getByRole("link", { name: "SafeLaunch" })).toHaveAttribute("href", "/vi");
    expect(screen.getByRole("link", { name: "VI / EN" })).toHaveAttribute(
      "href",
      "/en/report/report-token",
    );
  });

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
    expect(screen.queryByText(/đạt yêu cầu|tuân thủ hoàn toàn|clear(ed)? to launch/i)).toBeNull();
    // Coverage data attribute must signal "partial" so downstream tooling can hide approval CTAs.
    expect(screen.getByLabelText("Báo cáo tuân thủ")).toHaveAttribute("data-coverage", "partial");
  });

  it("renders the overall status banner with status-specific styling", () => {
    const highRiskReport: ReportPayload = { ...baseReport, status: "high_risk" };
    const { container: highContainer } = render(
      <ReportView report={highRiskReport} locale="vi" messages={viMessages} />,
    );
    const highBanner = screen.getByTestId("report-status-banner");
    expect(highBanner).toHaveAttribute("data-status", "high_risk");
    expect(highBanner).toHaveClass("border-error");
    expect(highContainer.querySelector('[data-testid="report-status-banner"]')).toHaveClass(
      "text-error",
    );

    const clearReport: ReportPayload = { ...baseReport, status: "no_significant_risk" };
    const { container: clearContainer } = render(
      <ReportView report={clearReport} locale="vi" messages={viMessages} />,
    );
    const clearBanner = clearContainer.querySelector('[data-testid="report-status-banner"]');
    expect(clearBanner).toHaveAttribute("data-status", "no_significant_risk");
    expect(clearBanner).toHaveClass("border-success");
    expect(clearBanner).toHaveClass("text-success");
  });

  it("displays the non-advice disclosure on the report view", () => {
    render(<ReportView report={baseReport} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("report-disclaimer")).toBeInTheDocument();
  });

  it("groups mixed findings by severity tab while preserving applicability labels", () => {
    const mixedReport: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "f-current", severity: "high", applicability: "current" }),
        buildFinding({ id: "f-upcoming", severity: "high", applicability: "upcoming" }),
        buildFinding({ id: "f-review", severity: "review", applicability: "upcoming" }),
      ],
    };
    render(<ReportView report={mixedReport} locale="vi" messages={viMessages} />);
    // Tabs replace the old "Hiện tại" / "Sắp tới" subsections.
    expect(screen.getByTestId("findings-tab-high")).toBeInTheDocument();
    expect(screen.getByTestId("findings-tab-review")).toBeInTheDocument();
    expect(screen.queryByTestId("findings-current-heading")).toBeNull();
    expect(screen.queryByTestId("findings-upcoming-heading")).toBeNull();
    // Applicability labels still appear inside cards so we don't lose information.
    expect(screen.getAllByText("Hiện tại").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sắp tới").length).toBeGreaterThan(0);
    // Upcoming banner is preserved.
    expect(screen.getByTestId("upcoming-banner-label")).toBeInTheDocument();
    expect(screen.getByTestId("upcoming-banner-label")).toBeInTheDocument();
  });

  it("renders English copy when the locale is 'en'", () => {
    render(<ReportView report={baseReport} locale="en" messages={enMessages} />);
    expect(screen.getByText("Compliance report")).toBeInTheDocument();
    expect(screen.getByText(/Scan coverage/i)).toBeInTheDocument();
  });
});

describe("digital rights report sections", () => {
  // Annotation per product: the service-signals, license-checks, and
  // asset-inventory sections are intentionally hidden from the user-facing
  // report view. The data is still in the payload and consumed by the API
  // (and the corresponding findings live in the findings tabs). These tests
  // lock in the "removed from UI, data unchanged" behavior.
  const reportWithAllDigitalRights: ReportPayload = {
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

  it("does not render the service-signals section even when serviceSignals data is present", () => {
    render(<ReportView report={reportWithAllDigitalRights} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("service-signals-section")).toBeNull();
    expect(screen.queryByText("Đăng bài")).toBeNull();
  });

  it("does not render the license-checks section even when licenseChecks data is present", () => {
    render(<ReportView report={reportWithAllDigitalRights} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("license-checks-section")).toBeNull();
  });

  it("does not render the asset-inventory section even when assetInventory data is present", () => {
    render(<ReportView report={reportWithAllDigitalRights} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("asset-inventory-section")).toBeNull();
    expect(screen.queryByText("https://cdn.example.com/hero.jpg")).toBeNull();
  });
});

describe("citation link hardening", () => {
  it("always shows fallback text instead of the link", () => {
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
    expect(screen.queryByTestId("provision-link-f-vbpl")).toBeNull();
    expect(screen.getByTestId("provision-link-unavailable-f-vbpl")).toHaveTextContent(
      "Liên kết nguồn không khả dụng",
    );
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
    expect(screen.getByTestId("provision-link-unavailable-f-bad")).toBeInTheDocument();
  });
});

describe("severity tabs", () => {
  it("shows a repeated rule-level error only once", () => {
    const duplicate = {
      ...buildFinding({
        id: "privacy-notice::error",
        severity: "review",
        applicability: "current",
      }),
      evidenceIds: [],
    };
    render(
      <ReportView
        report={{ ...baseReport, findings: [duplicate, duplicate, duplicate] }}
        locale="vi"
        messages={viMessages}
      />,
    );
    expect(screen.getByTestId("findings-tab-review")).toHaveTextContent("1");
  });

  it("renders a tab strip with severity counts", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "h1", severity: "high", applicability: "current" }),
        buildFinding({ id: "h2", severity: "high", applicability: "current" }),
        buildFinding({ id: "r1", severity: "review", applicability: "current" }),
        buildFinding({ id: "r2", severity: "review", applicability: "current" }),
        buildFinding({ id: "r3", severity: "review", applicability: "current" }),
        buildFinding({ id: "p1", severity: "pass", applicability: "current" }),
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("findings-tab-high")).toHaveTextContent("2");
    expect(screen.getByTestId("findings-tab-review")).toHaveTextContent("3");
    expect(screen.getByTestId("findings-tab-pass")).toHaveTextContent("1");
  });

  it("hides tabs with zero findings", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [buildFinding({ id: "h1", severity: "high", applicability: "current" })],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-tab-high")).toBeInTheDocument();
    expect(screen.queryByTestId("findings-tab-review")).toBeNull();
    expect(screen.queryByTestId("findings-tab-pass")).toBeNull();
  });

  it("defaults to Nghiêm trọng tab when it has findings", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "h1", severity: "high", applicability: "current" }),
        buildFinding({ id: "r1", severity: "review", applicability: "current" }),
        buildFinding({ id: "p1", severity: "pass", applicability: "current" }),
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-tab-high")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("findings-tabpanel-high")).toBeInTheDocument();
    expect(screen.queryByTestId("findings-tabpanel-review")).toBeNull();
    expect(screen.queryByTestId("findings-tabpanel-pass")).toBeNull();
  });

  it("defaults to first visible tab when Nghiêm trọng is empty", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [buildFinding({ id: "p1", severity: "pass", applicability: "current" })],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-tab-pass")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("findings-tabpanel-pass")).toBeInTheDocument();
  });

  it("switches tab on click", async () => {
    const user = userEvent.setup();
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "h1", severity: "high", applicability: "current" }),
        buildFinding({ id: "r1", severity: "review", applicability: "current" }),
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-tab-high")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByTestId("findings-tab-review"));
    expect(screen.getByTestId("findings-tab-review")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("findings-tab-high")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("findings-tabpanel-review")).toBeInTheDocument();
    expect(screen.queryByTestId("findings-tabpanel-high")).toBeNull();
  });

  it("renders the empty state and no tabs when there are no findings", () => {
    render(<ReportView report={baseReport} locale="vi" messages={viMessages} />);
    expect(screen.getByText(/không có phát hiện đáng kể/i)).toBeVisible();
    expect(screen.queryByTestId("findings-tabs")).toBeNull();
  });

  it("applies border-error to high severity cards", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [buildFinding({ id: "h1", severity: "high", applicability: "current" })],
    };
    const { container } = render(<ReportView report={report} locale="vi" messages={viMessages} />);
    const card = container.querySelector('[data-severity="high"]');
    expect(card).toHaveClass("border-l-error");
    expect(card).toHaveClass("bg-error/5");
  });

  it("applies border-gold to review severity cards", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [buildFinding({ id: "r1", severity: "review", applicability: "current" })],
    };
    const { container } = render(<ReportView report={report} locale="vi" messages={viMessages} />);
    const card = container.querySelector('[data-severity="review"]');
    expect(card).toHaveClass("border-l-gold");
    expect(card).toHaveClass("bg-gold/10");
  });

  it("applies border-success to pass severity cards", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [buildFinding({ id: "p1", severity: "pass", applicability: "current" })],
    };
    const { container } = render(<ReportView report={report} locale="vi" messages={viMessages} />);
    const card = container.querySelector('[data-severity="pass"]');
    expect(card).toHaveClass("border-l-success");
    expect(card).toHaveClass("bg-success/5");
  });

  it("sorts current findings before upcoming ones within a tab", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "h-up", severity: "high", applicability: "upcoming" }),
        buildFinding({ id: "h-cur", severity: "high", applicability: "current" }),
      ],
    };
    const { container } = render(<ReportView report={report} locale="vi" messages={viMessages} />);
    const panel = container.querySelector('[data-testid="findings-tabpanel-high"]');
    const ids = Array.from(panel?.querySelectorAll("[data-finding-id]") ?? []).map((el) =>
      el.getAttribute("data-finding-id"),
    );
    expect(ids).toEqual(["h-cur", "h-up"]);
  });

  it("renders a compact findings summary with direct severity counts", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "h1", severity: "high", applicability: "current" }),
        buildFinding({ id: "h2", severity: "high", applicability: "current" }),
        buildFinding({ id: "r1", severity: "review", applicability: "current" }),
        buildFinding({ id: "r2", severity: "review", applicability: "current" }),
        buildFinding({ id: "r3", severity: "review", applicability: "current" }),
        buildFinding({ id: "p1", severity: "pass", applicability: "current" }),
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-summary")).toBeInTheDocument();
    expect(screen.getByTestId("findings-summary-total")).toHaveTextContent("6");
    expect(screen.getByTestId("findings-summary-legend-high")).toHaveTextContent("2");
    expect(screen.getByTestId("findings-summary-legend-review")).toHaveTextContent("3");
    expect(screen.getByTestId("findings-summary-legend-pass")).toHaveTextContent("1");
    expect(screen.getByTestId("risk-distribution-chart")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/2.*3.*1/),
    );
    expect(screen.getByTestId("coverage-chart")).toBeInTheDocument();
  });

  it("keeps scan URLs and finding evidence collapsed by default", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [buildFinding({ id: "h1", severity: "high", applicability: "current" })],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("coverage-details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("finding-evidence-h1")).not.toHaveAttribute("open");
  });

  it("hides the findings summary when there are no findings", () => {
    render(<ReportView report={baseReport} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("findings-summary")).toBeNull();
    expect(screen.queryByTestId("findings-summary-total")).toBeNull();
  });
});

describe("font inventory (V1)", () => {
  it("groups Roboto variants into one row with a verified_open badge", () => {
    const report: ReportPayload = {
      ...baseReport,
      fontInventory: {
        groups: [
          {
            id: "font::roboto",
            family: "Roboto",
            kind: "font",
            host: "cdn.24h.com.vn",
            hosts: ["cdn.24h.com.vn"],
            variants: [
              {
                assetId: "asset::font::r1",
                url: "https://cdn.24h.com.vn/css/fonts/Roboto-Regular.woff2",
                format: "woff2",
                postscriptName: "Roboto-Regular",
                subfamilyName: "Regular",
                version: "Version 3.015",
                fileSha256: "6d6be3a7d40feb9b785e62c4b629a0e5949e50cbbbad06eea4800a4c311e9898",
                status: "fetched",
                licenseEvidence: "open_license_marker",
              },
              {
                assetId: "asset::font::r2",
                url: "https://cdn.24h.com.vn/css/fonts/Roboto-Bold.woff2",
                format: "woff2",
                postscriptName: "Roboto-Bold",
                subfamilyName: "Bold",
                version: "Version 3.015",
                fileSha256: "b64aec59c2342a732ec9a766e0846692dad652c571ca3bc7fd31bf53943887eb",
                status: "fetched",
                licenseEvidence: "open_license_marker",
              },
            ],
            fontInfo: {
              familyName: "Roboto",
              subfamilyName: "Regular",
              fullName: "Roboto Regular",
              postscriptName: "Roboto-Regular",
              version: "Version 3.015",
              copyright: "Copyright 2011 The Roboto Project Authors",
              vendorId: "GOOG",
              fsType: "installable",
              format: "WOFF2",
              fileSize: 17372,
            },
            fontLicense: {
              status: "verified_open",
              reasonCodes: ["registry_hash_match"],
              confidence: 0.95,
              evidenceSources: [
                {
                  provisionId: "google-fonts-snapshot-2026-08",
                  source: "Google Fonts OFL snapshot",
                  url: "https://github.com/google/fonts/tree/main/ofl",
                  retrievedAt: "2026-08-06T00:00:00.000Z",
                  excerpt: "Open-source fonts under SIL OFL 1.1.",
                },
              ],
              retrievedAt: "2026-08-06T00:00:00.000Z",
              registryVersion: "google-fonts-manual-snapshot-2026-08-06",
            },
            confidence: 0.95,
            flagged: false,
            citationCount: 1,
          },
        ],
        totals: { families: 1, files: 2, flagged: 0 },
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    // Font inventory is now rendered inside the Cần xem xét tab panel.
    const reviewPanel = screen.getByTestId("findings-tabpanel-review");
    expect(reviewPanel.querySelector('[data-testid="font-inventory-section"]')).not.toBeNull();
    expect(screen.getByTestId("font-family-row")).toBeInTheDocument();
    expect(screen.getByTestId("font-license-badge")).toHaveTextContent(/verified|registry/i);
    // Variants are listed in the <details> block (closed by default per product).
    const details = screen
      .getByText("https://cdn.24h.com.vn/css/fonts/Roboto-Regular.woff2")
      .closest("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("renders the IP law citation excerpt from evidenceSources at the panel header", () => {
    // Section-level legal basis block. The excerpt, source, URL, and retrievedAt
    // all come from the same evidenceSource already attached to every font's
    // fontLicense.evidenceSources array (provisionId "vn-ip-law-2022" — see
    // apps/workers/src/services/font-inspector.ts).
    const report: ReportPayload = {
      ...baseReport,
      fontInventory: {
        groups: [
          {
            id: "font::lora",
            family: "Lora",
            kind: "font",
            host: "fonts.example",
            hosts: ["fonts.example"],
            variants: [
              {
                assetId: "asset::font::lora-1",
                url: "https://fonts.example.com/lora.woff2",
                format: "woff2",
                postscriptName: "Lora-Regular",
                subfamilyName: "Regular",
                version: null,
                fileSha256: "a".repeat(64),
                status: "fetched",
                licenseEvidence: "no_license_evidence",
              },
            ],
            fontInfo: null,
            fontLicense: {
              status: "requires_license_proof",
              reasonCodes: ["commercial_catalog_name_hint"],
              confidence: 0.4,
              evidenceSources: [
                {
                  provisionId: "vn-ip-law-2022",
                  source: "Luật Sở hữu trí tuệ 2022",
                  url: "https://vbpl.vn/tim-kiem?SearchIn=all&q=Lu%E1%BA%ADt%20S%E1%BB%9F%20h%E1%BB%AFu%20tr%C3%AD%20tu%E1%BB%87%202022",
                  retrievedAt: "2026-08-06T00:00:00.000Z",
                  excerpt:
                    "Tổ chức, cá nhân sử dụng tác phẩm, bản ghi âm, hình ảnh, chương trình phát sóng phải có sự đồng ý của chủ sở hữu hoặc theo giấy phép tương ứng.",
                },
              ],
              retrievedAt: "2026-08-06T00:00:00.000Z",
              registryVersion: null,
            },
            confidence: 0.4,
            flagged: true,
            citationCount: 1,
          },
        ],
        totals: { families: 1, files: 1, flagged: 1 },
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    const fontSection = screen.getByTestId("font-inventory-section");
    // The IP law excerpt must be rendered inside the font inventory panel.
    expect(within(fontSection).getByText(/sự đồng ý của chủ sở hữu/i)).toBeInTheDocument();
    // The source label (used as the link text) must point at vbpl.vn.
    const sourceLink = within(fontSection).getByRole("link", {
      name: /Luật Sở hữu trí tuệ 2022/,
    });
    expect(sourceLink).toHaveAttribute("href", expect.stringContaining("vbpl.vn"));
    // Section-level block has its own testid so other tools can target it.
    expect(within(fontSection).getByTestId("font-ip-law-citation")).toBeInTheDocument();
  });

  it("does not render the IP law citation block when no font provides the citation", () => {
    // If the corpus ever drops the vn-ip-law-2022 citation, the UI must not
    // crash or invent text — the section is omitted entirely.
    const report: ReportPayload = {
      ...baseReport,
      fontInventory: {
        groups: [
          {
            id: "font::lora",
            family: "Lora",
            kind: "font",
            host: "fonts.example",
            hosts: ["fonts.example"],
            variants: [
              {
                assetId: "asset::font::lora-1",
                url: "https://fonts.example.com/lora.woff2",
                format: "woff2",
                postscriptName: "Lora-Regular",
                subfamilyName: "Regular",
                version: null,
                fileSha256: "a".repeat(64),
                status: "fetched",
                licenseEvidence: "no_license_evidence",
              },
            ],
            fontInfo: null,
            fontLicense: {
              status: "requires_license_proof",
              reasonCodes: ["commercial_catalog_name_hint"],
              confidence: 0.4,
              evidenceSources: [],
              retrievedAt: "2026-08-06T00:00:00.000Z",
              registryVersion: null,
            },
            confidence: 0.4,
            flagged: true,
            citationCount: 0,
          },
        ],
        totals: { families: 1, files: 1, flagged: 1 },
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.queryByTestId("font-ip-law-citation")).toBeNull();
  });

  it("falls back to the text 'Source link unavailable' when a citation host is not approved", () => {
    const report: ReportPayload = {
      ...baseReport,
      fontInventory: {
        groups: [
          {
            id: "font::helvetica",
            family: "Helvetica",
            kind: "font",
            host: "fonts.cdn.example",
            hosts: ["fonts.cdn.example"],
            variants: [
              {
                assetId: "asset::font::h1",
                url: "https://fonts.cdn.example/helvetica.woff2",
                format: "woff2",
                postscriptName: "Helvetica",
                subfamilyName: "Regular",
                version: null,
                fileSha256: "a".repeat(64),
                status: "fetched",
                licenseEvidence: "no_license_evidence",
              },
            ],
            fontInfo: null,
            fontLicense: {
              status: "requires_license_proof",
              reasonCodes: ["commercial_catalog_name_hint"],
              confidence: 0.4,
              evidenceSources: [
                {
                  provisionId: "vn-ip-law-2022",
                  source: "Luật SHTT 2022",
                  url: "https://example.com/evil",
                  retrievedAt: "2026-08-06T00:00:00.000Z",
                  excerpt: "...",
                },
              ],
              retrievedAt: "2026-08-06T00:00:00.000Z",
              registryVersion: null,
            },
            confidence: 0.4,
            flagged: true,
            citationCount: 1,
          },
        ],
        totals: { families: 1, files: 1, flagged: 1 },
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByText(/Liên kết nguồn không khả dụng/i)).toBeInTheDocument();
  });
});

describe("font deduplication in findings tabs", () => {
  const fontAssetIdA = "asset::font::fraunces-a";
  const fontAssetIdB = "asset::font::fraunces-b";
  const imageAssetId = "asset::image::hero";
  const baseFontFinding = (id: string) => ({
    ...buildFinding({ id, severity: "review", applicability: "current" }),
    evidenceIds: [id === "font-1" ? fontAssetIdA : fontAssetIdB],
  });
  const baseImageFinding = {
    ...buildFinding({ id: "image-1", severity: "review", applicability: "current" }),
    evidenceIds: [imageAssetId],
  };

  const buildReport = (): ReportPayload => ({
    ...baseReport,
    assetInventory: {
      summary: { total: 3, byKind: { font: 2, image: 1 }, flagged: 3 },
      assets: [
        {
          id: fontAssetIdA,
          kind: "font",
          url: "https://cdn.example.com/font-a.woff2",
          host: "cdn.example.com",
          sourceUrl: "https://example.com/",
          contentType: "font/woff2",
          sha256: "a".repeat(64),
          status: "fetched",
          licenseEvidence: "copyright_notice_only",
          licenseExcerpt: null,
          confidence: 0.4,
        },
        {
          id: fontAssetIdB,
          kind: "font",
          url: "https://cdn.example.com/font-b.woff2",
          host: "cdn.example.com",
          sourceUrl: "https://example.com/",
          contentType: "font/woff2",
          sha256: "b".repeat(64),
          status: "fetched",
          licenseEvidence: "copyright_notice_only",
          licenseExcerpt: null,
          confidence: 0.4,
        },
        {
          id: imageAssetId,
          kind: "image",
          url: "https://cdn.example.com/hero.jpg",
          host: "cdn.example.com",
          sourceUrl: "https://example.com/",
          contentType: "image/jpeg",
          sha256: "c".repeat(64),
          status: "fetched",
          licenseEvidence: "no_license_evidence",
          licenseExcerpt: null,
          confidence: 0.4,
        },
      ],
    },
    findings: [
      baseFontFinding("font-1"),
      baseFontFinding("font-2"),
      baseImageFinding,
      buildFinding({ id: "high-1", severity: "high", applicability: "current" }),
    ],
  });

  it("hides font-only findings from the Cần xem xét tab and lowers counts", () => {
    const report = buildReport();
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    // 2 font findings hidden; 1 image + 1 high kept → review=1, high=1, total=2
    expect(screen.getByTestId("findings-tab-review")).toHaveTextContent("1");
    expect(screen.getByTestId("findings-tab-high")).toHaveTextContent("1");
    expect(screen.getByTestId("findings-summary-total")).toHaveTextContent("2");
    // Legend reflects the filtered counts.
    expect(screen.getByTestId("findings-summary-legend-review")).toHaveTextContent("1");
  });

  it("does not render font-only finding cards inside the review tab panel", async () => {
    const user = userEvent.setup();
    const report = buildReport();
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    await user.click(screen.getByTestId("findings-tab-review"));
    const panel = screen.getByTestId("findings-tabpanel-review");
    expect(panel.querySelector('[data-finding-id="font-1"]')).toBeNull();
    expect(panel.querySelector('[data-finding-id="font-2"]')).toBeNull();
    expect(panel.querySelector('[data-finding-id="image-1"]')).not.toBeNull();
  });

  it("still shows font findings when no assetInventory is provided (backwards compatible)", () => {
    const report: ReportPayload = {
      ...baseReport,
      findings: [
        buildFinding({ id: "r1", severity: "review", applicability: "current" }),
        buildFinding({ id: "r2", severity: "review", applicability: "current" }),
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("findings-tab-review")).toHaveTextContent("2");
    expect(screen.getByTestId("findings-summary-total")).toHaveTextContent("2");
  });

  it("keeps findings that mix font and non-font evidence (all-evidenceIds-must-be-font rule)", () => {
    const report: ReportPayload = {
      ...baseReport,
      assetInventory: {
        summary: { total: 2, byKind: { font: 1, image: 1 }, flagged: 2 },
        assets: [
          {
            id: fontAssetIdA,
            kind: "font",
            url: "https://cdn.example.com/font-a.woff2",
            host: "cdn.example.com",
            sourceUrl: "https://example.com/",
            contentType: "font/woff2",
            sha256: "a".repeat(64),
            status: "fetched",
            licenseEvidence: "copyright_notice_only",
            licenseExcerpt: null,
            confidence: 0.4,
          },
          {
            id: imageAssetId,
            kind: "image",
            url: "https://cdn.example.com/hero.jpg",
            host: "cdn.example.com",
            sourceUrl: "https://example.com/",
            contentType: "image/jpeg",
            sha256: "c".repeat(64),
            status: "fetched",
            licenseEvidence: "no_license_evidence",
            licenseExcerpt: null,
            confidence: 0.4,
          },
        ],
      },
      findings: [
        {
          ...buildFinding({ id: "mixed-1", severity: "review", applicability: "current" }),
          evidenceIds: [fontAssetIdA, imageAssetId],
        },
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    // The mixed-evidence finding is kept (it carries non-font information).
    expect(screen.getByTestId("findings-tab-review")).toHaveTextContent("1");
    expect(screen.getByTestId("findings-summary-total")).toHaveTextContent("1");
  });

  it("renders the font inventory inside the Cần xem xét tab panel (not as a standalone section)", async () => {
    const user = userEvent.setup();
    const report: ReportPayload = {
      ...baseReport,
      // Seed a high-severity finding so the high tab is rendered; the user
      // clicks it to verify the font inventory does NOT leak into the high tab.
      findings: [buildFinding({ id: "high-sev", severity: "high", applicability: "current" })],
      fontInventory: {
        groups: [
          {
            id: "font::lora",
            family: "Lora",
            kind: "font",
            host: "fonts.example",
            hosts: ["fonts.example"],
            variants: [
              {
                assetId: "asset::font::lora-1",
                url: "https://fonts.example.com/lora.woff2",
                format: "woff2",
                postscriptName: "Lora-Regular",
                subfamilyName: "Regular",
                version: null,
                fileSha256: "a".repeat(64),
                status: "fetched",
                licenseEvidence: "no_license_evidence",
              },
            ],
            fontInfo: null,
            fontLicense: {
              status: "requires_license_proof",
              reasonCodes: ["commercial_catalog_name_hint"],
              confidence: 0.4,
              evidenceSources: [],
              retrievedAt: "2026-08-06T00:00:00.000Z",
              registryVersion: null,
            },
            confidence: 0.4,
            flagged: true,
            citationCount: 0,
          },
        ],
        totals: { families: 1, files: 1, flagged: 1 },
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    // The high tab is active by default; switch to the review tab so we can
    // inspect its panel content.
    await user.click(screen.getByTestId("findings-tab-review"));
    // The font-inventory-section must ONLY exist inside the review tab panel.
    // It must NOT render inside the (currently active) high tab panel — see
    // https://safelaunch.runany.dev review feedback: "block cần nằm trong tab
    // 'Cần xem xét' và chỉ hiển thị khi mở tab".
    const reviewPanel = screen.getByTestId("findings-tabpanel-review");
    expect(reviewPanel.querySelector('[data-testid="font-inventory-section"]')).not.toBeNull();
    expect(screen.getByText("Lora")).toBeInTheDocument();

    // When the user clicks back to the high tab, the font inventory must NOT
    // follow. This protects against the previous bug where FontInventoryPanel
    // rendered inside every active tabpanel.
    await user.click(screen.getByTestId("findings-tab-high"));
    expect(screen.getByTestId("findings-tabpanel-high")).toBeInTheDocument();
    expect(screen.queryByTestId("font-inventory-section")).toBeNull();
  });

  it("keeps the review tab visible when the only flagged items are fonts (font inventory still renders)", () => {
    // Even if all review findings are font findings (filtered out), the review
    // tab should remain visible because the font inventory panel needs a tab
    // to live in.
    const report: ReportPayload = {
      ...baseReport,
      assetInventory: {
        summary: { total: 1, byKind: { font: 1 }, flagged: 1 },
        assets: [
          {
            id: fontAssetIdA,
            kind: "font",
            url: "https://cdn.example.com/font-a.woff2",
            host: "cdn.example.com",
            sourceUrl: "https://example.com/",
            contentType: "font/woff2",
            sha256: "a".repeat(64),
            status: "fetched",
            licenseEvidence: "copyright_notice_only",
            licenseExcerpt: null,
            confidence: 0.4,
          },
        ],
      },
      fontInventory: {
        groups: [
          {
            id: "font::fraunces",
            family: "Fraunces",
            kind: "font",
            host: "cdn.example.com",
            hosts: ["cdn.example.com"],
            variants: [
              {
                assetId: fontAssetIdA,
                url: "https://cdn.example.com/font-a.woff2",
                format: "woff2",
                postscriptName: "Fraunces-Regular",
                subfamilyName: "Regular",
                version: null,
                fileSha256: "a".repeat(64),
                status: "fetched",
                licenseEvidence: "copyright_notice_only",
              },
            ],
            fontInfo: null,
            fontLicense: null,
            confidence: 0.4,
            flagged: true,
            citationCount: 0,
          },
        ],
        totals: { families: 1, files: 1, flagged: 1 },
      },
      findings: [
        {
          ...buildFinding({ id: "font-only-1", severity: "review", applicability: "current" }),
          evidenceIds: [fontAssetIdA],
        },
      ],
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    // The review tab is visible because there's a font inventory panel to show.
    expect(screen.getByTestId("findings-tab-review")).toBeInTheDocument();
    expect(screen.getByTestId("findings-tabpanel-review")).toBeInTheDocument();
    // The font inventory renders inside the panel even though the only
    // review finding was filtered out as a font-only finding.
    const reviewPanel = screen.getByTestId("findings-tabpanel-review");
    expect(reviewPanel.querySelector('[data-testid="font-inventory-section"]')).not.toBeNull();
    // The empty-state message must NOT appear (font inventory is content).
    expect(reviewPanel.querySelector("p")?.textContent ?? "").not.toMatch(/không có phát hiện/i);
  });

  it("renders font variants details closed by default", () => {
    const report: ReportPayload = {
      ...baseReport,
      fontInventory: {
        groups: [
          {
            id: "font::inter",
            family: "Inter",
            kind: "font",
            host: "fonts.example",
            hosts: ["fonts.example"],
            variants: [
              {
                assetId: "asset::font::inter-1",
                url: "https://fonts.example.com/inter.woff2",
                format: "woff2",
                postscriptName: "Inter-Regular",
                subfamilyName: "Regular",
                version: null,
                fileSha256: "a".repeat(64),
                status: "fetched",
                licenseEvidence: "open_license_marker",
              },
            ],
            fontInfo: null,
            fontLicense: {
              status: "verified_open",
              reasonCodes: ["registry_hash_match"],
              confidence: 0.95,
              evidenceSources: [],
              retrievedAt: "2026-08-06T00:00:00.000Z",
              registryVersion: "google-fonts-manual-snapshot-2026-08-06",
            },
            confidence: 0.95,
            flagged: false,
            citationCount: 0,
          },
        ],
        totals: { families: 1, files: 1, flagged: 0 },
      },
    };
    render(<ReportView report={report} locale="vi" messages={viMessages} />);
    // We need a review-tab finding to make the panel render, but with the
    // current data the font itself is "verified_open" so no finding is
    // produced. To exercise the details, build a minimal case with one
    // review finding so the panel renders.
    // Actually: when fontInventory has groups but no findings, the review
    // tab should still render (font inventory panel). So we can just check
    // the details is present.
    const reviewPanel = screen.getByTestId("findings-tabpanel-review");
    const details = reviewPanel.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });
});
