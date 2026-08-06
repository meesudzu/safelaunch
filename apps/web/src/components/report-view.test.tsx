import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
      "bg-error/10",
    );

    const clearReport: ReportPayload = { ...baseReport, status: "no_significant_risk" };
    const { container: clearContainer } = render(
      <ReportView report={clearReport} locale="vi" messages={viMessages} />,
    );
    const clearBanner = clearContainer.querySelector('[data-testid="report-status-banner"]');
    expect(clearBanner).toHaveAttribute("data-status", "no_significant_risk");
    expect(clearBanner).toHaveClass("border-success");
    expect(clearBanner).toHaveClass("bg-success/10");
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
    expect(screen.getByTestId("provision-link-unavailable-f-bad")).toBeVisible();
  });
});

describe("severity tabs", () => {
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

  it("renders a findings summary with a total count and severity legend", () => {
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
    expect(screen.getByTestId("findings-summary-legend-high")).toHaveTextContent("33%");
    expect(screen.getByTestId("findings-summary-legend-review")).toHaveTextContent("3");
    expect(screen.getByTestId("findings-summary-legend-review")).toHaveTextContent("50%");
    expect(screen.getByTestId("findings-summary-legend-pass")).toHaveTextContent("1");
    expect(screen.getByTestId("findings-summary-legend-pass")).toHaveTextContent("17%");
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
    expect(screen.getByTestId("font-inventory-section")).toBeInTheDocument();
    expect(screen.getByTestId("font-family-row")).toBeInTheDocument();
    expect(screen.getByTestId("font-license-badge")).toHaveTextContent(/verified|registry/i);
    // Variants are listed in the <details> block (open by default).
    expect(screen.getByText("https://cdn.24h.com.vn/css/fonts/Roboto-Regular.woff2")).toBeVisible();
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
