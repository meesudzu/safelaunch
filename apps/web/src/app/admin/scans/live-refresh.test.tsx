import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveRefresh } from "./live-refresh";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// jsdom defaults visibilityState to "visible", which is what the existing
// happy-path tests already assume. The hidden-tab test toggles it directly.
const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  vi.useRealTimers();
  refresh.mockReset();
  setVisibility("visible");
});

describe("LiveRefresh", () => {
  it("polls every five seconds while visible and stops after unmount", () => {
    vi.useFakeTimers();
    setVisibility("visible");
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

  it("pauses polling while the tab is hidden and resumes on visibility", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    render(<LiveRefresh enabled />);
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Hide the tab: subsequent ticks must NOT call refresh.
    setVisibility("hidden");
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Show the tab: polling resumes, so the next 5s tick fires.
    setVisibility("visible");
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
