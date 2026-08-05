import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveRefresh } from "./live-refresh";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  vi.useRealTimers();
  refresh.mockReset();
});
describe("LiveRefresh", () => {
  it("polls every five seconds and stops after unmount", () => {
    vi.useFakeTimers();
    const view = render(<LiveRefresh enabled />);
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("does not poll terminal-only views", () => {
    vi.useFakeTimers();
    render(<LiveRefresh enabled={false} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
