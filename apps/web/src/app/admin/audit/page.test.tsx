import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuditPage from "./page";

const originalOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
  else process.env.NEXT_PUBLIC_API_ORIGIN = originalOrigin;
});

describe("admin audit page", () => {
  it("renders filters, audit rows, and pagination", async () => {
    process.env.NEXT_PUBLIC_API_ORIGIN = "https://api.example.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "evt-1",
              documentId: "doc-1",
              actor: "reviewer@safelaunch.test",
              decision: "approved",
              reason: "Nguồn và điều khoản đã được kiểm tra.",
              createdAt: "2026-08-05T10:00:00.000Z",
              documentTitle: "Văn bản thử nghiệm",
              jurisdiction: "VN",
            },
          ],
          nextCursor: "next-page",
          window: { from: "2026-07-29T10:00:00.000Z", to: null },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const element = await AuditPage({
      searchParams: Promise.resolve({ decision: "approved", actor: "reviewer@safelaunch.test" }),
    });
    render(element);

    expect(screen.getByRole("heading", { name: "Nhật ký xét duyệt" })).toBeInTheDocument();
    expect(screen.getByText("Văn bản thử nghiệm")).toBeInTheDocument();
    expect(screen.getByText("Nguồn và điều khoản đã được kiểm tra.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trang tiếp theo" })).toHaveAttribute(
      "href",
      expect.stringContaining("cursor=next-page"),
    );
    expect(screen.getByRole("link", { name: "Trang tiếp theo" })).toHaveAttribute(
      "href",
      expect.stringContaining("from=2026-07-29T10%3A00%3A00.000Z"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("decision=approved"),
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
