import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScanStepper, type ScanStepperMessages } from "./scan-stepper";

const messages: ScanStepperMessages = {
  "steps.title": "Các bước quét",
  "steps.subtitle": "Bước {current} / {total}",
  "step.queued.label": "Đang chờ",
  "step.queued.description": "Đang xếp hàng để bắt đầu quét",
  "step.fetching.label": "Đang tải trang",
  "step.fetching.description": "Đang đọc từng URL trong phạm vi quét",
  "step.extracting.label": "Đang trích xuất nội dung",
  "step.extracting.description": "Đang tách văn bản, liên kết và tài sản số",
  "step.retrieving.label": "Đang tra cứu văn bản pháp luật",
  "step.retrieving.description": "Đang tìm điều khoản liên quan trong kho dữ liệu pháp lý",
  "step.evaluating.label": "�ang đánh giá",
  "step.evaluating.description": "Đang so khớp bằng chứng với từng điều khoản",
  "step.reporting.label": "Đang soạn báo cáo",
  "step.reporting.description": "Đang tổng h�p kết quả và ghi chú cho bạn",
};

describe("ScanStepper — anti-slop snapshot guard", () => {
  // Hallmark guard: this test is here to flag any future edit that drifts
  // back to the LLM defaults the skill warns about — gradient progress
  // bars, glassmorphism, emoji-as-bullet rows, "Inter-only" type pairings,
  // centered hero + 3-icon rows. The class assertion below is the
  // minimal guard; full visual audit still belongs to a human reviewer.
  it("does not introduce gradient, glassmorphism, or emoji bullets", () => {
    const { container } = render(
      <ScanStepper locale="vi" messages={messages} currentState="evaluating" />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/bg-gradient|backdrop-blur|drop-shadow/i);
    // No raw emoji used as the visual marker — the steppers use ✓ ✕ and
    // numerals; the bullets below are checked separately.
    expect(html).not.toMatch(/🚀|⚡|🎯|✨|✅|❌/);
  });

  it("uses the serif (Source Serif 4) font for numerals and the sans body for labels", () => {
    const { container } = render(
      <ScanStepper locale="vi" messages={messages} currentState="evaluating" />,
    );
    // aria-current="step" is on the active <li>. Inside, the connector rule
    // and the marker are both <span>s; the marker is the only one with the
    // rounded-full class.
    const activeItem = container.querySelector("[aria-current='step']");
    const marker = activeItem?.querySelector("span.rounded-full");
    expect(marker).not.toBeNull();
    expect(marker?.className ?? "").toContain("font-serif");
    // The label/description block is the <div> sibling of the marker.
    const label = activeItem?.querySelector("div");
    expect(label?.className ?? "").not.toContain("font-serif");
  });

  it("honours prefers-reduced-motion via the motion-reduce Tailwind variant on the active pulse", () => {
    const { container } = render(
      <ScanStepper locale="vi" messages={messages} currentState="evaluating" />,
    );
    const activeItem = container.querySelector("[aria-current='step']");
    const marker = activeItem?.querySelector("span.rounded-full");
    expect(marker).not.toBeNull();
    expect(marker?.className ?? "").toMatch(/motion-reduce:animate-none/);
  });
});
