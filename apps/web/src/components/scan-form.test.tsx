import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScanForm, type ScanFormProps } from "./scan-form";



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
  "form.jurisdiction.value": "Việt Nam (MVP)",
  "form.submit": "Kiểm tra website",
  "form.submitting": "Đang quét…",
  "form.error.url": "Vui lòng nhập URL hợp lệ.",
  "form.error.category": "Vui lòng chọn loại ứng dụng.",
  "form.error.submit": "Không thể gửi yêu cầu quét.",
  disclosure: "Báo cáo này là tín hiệu tham khảo, không phải tư vấn pháp lý.",
  "footer.disclosure": "Báo cáo tham khảo, không phải tư vấn pháp lý.",
  "footer.version": "v0.1",
} as const;

const createScan: ScanFormProps["createScan"] = vi.fn(() => Promise.resolve({ scanId: "scan_test", state: "queued" as const }));

describe("ScanForm", () => {
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
    expect(jurisdiction).toHaveValue("Việt Nam (MVP)");
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
});
