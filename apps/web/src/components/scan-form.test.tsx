import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScanForm, type ScanFormProps } from "./scan-form";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const viMessages = {
  brand: "SafeLaunch",
  "locale.switch": "VI / EN",
  headline: "Ra mắt toàn cầu. Tuân thủ ngay từ đầu.",
  subhead: "Một báo cáo tín hiệu tuân thủ.",
  "trust.signals": "Không yêu cầu tài khoản · Trích dẫn đầy đủ · Mã nguồn có thể kiểm chứng",
  "source.citation": "Cơ sở pháp lý: vbpl.vn.",
  "form.url.label": "URL website",
  "form.url.placeholder": "https://example.com",
  "form.url.help": "Chỉ URL công khai.",
  "form.category.label": "Loại ứng dụng",
  "form.category.online_game": "Trò chơi điện tử",
  "form.category.electronic_press": "Báo chí điện tử",
  "form.category.digital_entertainment": "Giải trí số",
  "form.jurisdiction.label": "Khu vực pháp lý",
  "form.jurisdiction.value": "Việt Nam",
  "form.submit": "Kiểm tra website",
  "form.submitting": "Đang quét…",
  "form.error.url": "Vui lòng nhập URL hợp lệ.",
  "form.error.category": "Vui lòng chọn loại ứng dụng.",
  "form.error.submit": "Không thể gửi yêu cầu quét.",
  disclosure: "Báo cáo này là tín hiệu tham khảo, không phải tư vấn pháp lý.",
  "footer.disclosure": "Báo cáo tham khảo, không phải tư vấn pháp lý.",
  "footer.version": "v0.1",
  "quota.disclaimer": "Mỗi website chỉ được quét 1 lần mỗi ngày (UTC).",
  "quota.redeem.toggle": "Tôi có redeem code",
  "quota.redeem.label": "Redeem code",
  "quota.redeem.placeholder": "SL-XXXX-XXXX",
  "quota.redeem.invalid": "Redeem code không hợp lệ hoặc đã hết hạn.",
  "quota.redeem.used": "Redeem code đã được dùng cho domain hôm nay.",
} as const;

const createScan = vi.fn(() => Promise.resolve({ scanId: "scan_test", state: "queued" as const })) as NonNullable<ScanFormProps["createScan"]>;

describe("ScanForm", () => {
  it("navigates to the live scan progress screen after the API accepts the scan", async () => {
    pushMock.mockClear();
    const user = userEvent.setup();
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);

    await user.type(screen.getByLabelText("URL website"), "https://example.com");
    await user.selectOptions(screen.getByLabelText("Loại ứng dụng"), "online_game");
    await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));

    expect(pushMock).toHaveBeenCalledWith("/vi/scan/scan_test");
  });

  it("submits the Vietnam scan contract without authentication", async () => {
    const user = userEvent.setup();
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);

    await user.type(screen.getByLabelText("URL website"), "https://example.com");
    await user.selectOptions(screen.getByLabelText("Loại ứng dụng"), "online_game");
    await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));

    expect(createScan).toHaveBeenCalledWith({
      url: "https://example.com",
      jurisdiction: "VN",
      category: "online_game",
    });
  });

  it("displays the non-advice disclosure above the submit button", () => {
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    const disclosure = screen.getByTestId("scan-disclosure");
    const submit = screen.getByRole("button", { name: "Kiểm tra website" });
    expect(
      disclosure.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("locks the jurisdiction selector to Vietnam for the MVP", () => {
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    const jurisdiction = screen.getByLabelText("Khu vực pháp lý");
    expect(jurisdiction).toBeDisabled();
    expect(jurisdiction).toHaveValue("Việt Nam");
  });

  it("shows an inline error when the URL is invalid", async () => {
    const user = userEvent.setup();
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    await user.type(screen.getByLabelText("URL website"), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));
    expect(screen.getByText(/URL hợp lệ/)).toBeInTheDocument();
    expect(createScan).not.toHaveBeenCalled();
  });

  it("renders Vietnamese copy when the locale is 'vi'", () => {
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    expect(screen.getByLabelText("URL website")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Loại ứng dụng/ })).toBeInTheDocument();
  });

  it("renders the quota disclaimer", () => {
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    expect(screen.getByTestId("quota-disclaimer")).toBeInTheDocument();
  });

  it("opens the redeem code field when the toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    await user.click(screen.getByText("Tôi có redeem code"));
    expect(screen.getByTestId("redeem-input")).toBeInTheDocument();
  });

  it("renders the cached banner when the API returns a cached payload", async () => {
    const createScanCached: ScanFormProps["createScan"] = vi.fn(() =>
      Promise.resolve({
        scanId: "scan_cached",
        state: "completed",
        status: "needs_review",
        coverage: { fetched: [], failed: [], skipped: [] },
        createdAt: "2026-08-03T10:00:00.000Z",
        expiresAt: "2026-08-10T10:00:00.000Z",
        reportUrl: "https://example.com/report/tok1",
        cached: true,
        quotaDay: "2026-08-03",
        domainKey: "example.com",
        message: "scan.cached.used",
      }),
    );
    const user = userEvent.setup();
    render(<ScanForm createScan={createScanCached} locale="vi" messages={viMessages} />);
    await user.type(screen.getByLabelText("URL website"), "https://example.com");
    await user.selectOptions(screen.getByLabelText("Loại ứng dụng"), "online_game");
    await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));
    expect(await screen.findByTestId("cached-banner")).toBeInTheDocument();
  });

  it("submits the redeem code when present", async () => {
    const user = userEvent.setup();
    render(<ScanForm createScan={createScan} locale="vi" messages={viMessages} />);
    await user.type(screen.getByLabelText("URL website"), "https://example.com");
    await user.selectOptions(screen.getByLabelText("Loại ứng dụng"), "online_game");
    await user.click(screen.getByText("Tôi có redeem code"));
    await user.type(screen.getByTestId("redeem-input"), "SL-A2K9-7X4P");
    await user.click(screen.getByRole("button", { name: "Kiểm tra website" }));
    expect(createScan).toHaveBeenCalledWith({
      url: "https://example.com",
      jurisdiction: "VN",
      category: "online_game",
      redeemCode: "SL-A2K9-7X4P",
    });
  });
});
