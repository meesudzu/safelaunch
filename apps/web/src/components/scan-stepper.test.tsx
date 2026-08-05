import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SCAN_PIPELINE, ScanStepper, type ScanStepperMessages } from "./scan-stepper";

const baseMessages: ScanStepperMessages = {
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
  "step.evaluating.label": "Đang đánh giá",
  "step.evaluating.description": "Đang so khớp bằng chứng với từng điều khoản",
  "step.reporting.label": "Đang soạn báo cáo",
  "step.reporting.description": "Đang tổng hợp kết quả và ghi chú cho bạn",
};

const getList = () => screen.getByRole("list", { name: /các bước quét/i });

const activeItems = () => getList().querySelectorAll<HTMLElement>("[aria-current='step']");

const completedMarkers = () =>
  Array.from(getList().querySelectorAll<HTMLElement>("[data-testid='step-completed']"));

const queryMarker = (id: string) => getList().querySelector(`[data-testid='${id}']`);

describe("ScanStepper", () => {
  it("renders exactly the six pipeline steps in the canonical order", () => {
    render(<ScanStepper locale="vi" messages={baseMessages} currentState="fetching" />);

    const items = within(getList()).getAllByRole("listitem");
    expect(items).toHaveLength(SCAN_PIPELINE.length);
    expect(SCAN_PIPELINE).toEqual([
      "queued",
      "fetching",
      "extracting",
      "retrieving",
      "evaluating",
      "reporting",
    ]);
  });

  it.each(["queued", "fetching", "extracting", "retrieving", "evaluating", "reporting"] as const)(
    "marks only the matching step as active for state=%s",
    (state) => {
      render(<ScanStepper locale="vi" messages={baseMessages} currentState={state} />);

      const items = within(getList()).getAllByRole("listitem");
      const active = activeItems();
      expect(active).toHaveLength(1);
      const activeIndex = items.indexOf(active[0] as HTMLElement);
      expect(SCAN_PIPELINE[activeIndex]).toBe(state);

      expect(completedMarkers()).toHaveLength(activeIndex);
    },
  );

  it("marks all six steps completed and removes aria-current when terminal=completed", () => {
    render(<ScanStepper locale="vi" messages={baseMessages} currentState="completed" />);

    expect(activeItems()).toHaveLength(0);
    expect(completedMarkers()).toHaveLength(SCAN_PIPELINE.length);
    expect(queryMarker("step-failed")).toBeNull();
    expect(queryMarker("step-partial")).toBeNull();
  });

  it("marks the failed step with error styling when terminal=failed", () => {
    render(<ScanStepper locale="vi" messages={baseMessages} currentState="failed" />);

    expect(activeItems()).toHaveLength(0);
    expect(queryMarker("step-failed")).not.toBeNull();
    expect(completedMarkers().length).toBeGreaterThan(0);
  });

  it("marks the final step with a gold (partial) marker when terminal=partial", () => {
    render(<ScanStepper locale="vi" messages={baseMessages} currentState="partial" />);

    expect(activeItems()).toHaveLength(0);
    expect(queryMarker("step-partial")).not.toBeNull();
    expect(queryMarker("step-failed")).toBeNull();
  });

  it("renders localized label + description for every step in vi", () => {
    render(<ScanStepper locale="vi" messages={baseMessages} currentState="retrieving" />);

    for (const step of SCAN_PIPELINE) {
      const labelKey = `step.${step}.label` as const;
      const descKey = `step.${step}.description` as const;
      expect(screen.getByText(baseMessages[labelKey])).toBeInTheDocument();
      expect(screen.getByText(baseMessages[descKey])).toBeInTheDocument();
    }
  });

  it("falls back to a queued view without crashing for unknown states", () => {
    expect(() =>
      render(<ScanStepper locale="vi" messages={baseMessages} currentState="not_a_real_state" />),
    ).not.toThrow();
    const items = within(getList()).getAllByRole("listitem");
    const active = activeItems();
    expect(active).toHaveLength(1);
    expect(items.indexOf(active[0] as HTMLElement)).toBe(0);
  });

  it("renders the stepper heading from messages.steps.title", () => {
    render(<ScanStepper locale="vi" messages={baseMessages} currentState="evaluating" />);
    expect(screen.getByRole("heading", { name: baseMessages["steps.title"] })).toBeInTheDocument();
  });

  it("renders a loading spinner inside the active marker only", () => {
    const { container } = render(
      <ScanStepper locale="vi" messages={baseMessages} currentState="evaluating" />,
    );
    // Only the active marker carries an inline <svg> spinner; pending and
    // completed markers do not.
    const activeItem = container.querySelector("[aria-current='step']");
    expect(activeItem?.querySelector("svg")).not.toBeNull();

    // Sanity: every other listitem has no spinner svg.
    const items = within(getList()).getAllByRole("listitem");
    for (const item of items) {
      if (item.getAttribute("aria-current") === "step") continue;
      expect(item.querySelector("svg")).toBeNull();
    }
  });
});
