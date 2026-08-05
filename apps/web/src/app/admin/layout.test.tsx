import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: () =>
    new Headers({
      "cf-access-authenticated-user-email": "reviewer@safelaunch.app",
    }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/audit",
}));

import AdminLayout, { metadata } from "./layout";

describe("AdminLayout", () => {
  it("renders the shared admin shell with actor, logout, and navigation", () => {
    render(
      <AdminLayout>
        <p>Page content</p>
      </AdminLayout>,
    );

    expect(metadata.title).toBe("SafeLaunch Admin");
    expect(screen.getByText("Reviewer")).toBeVisible();
    expect(screen.getByText("reviewer@safelaunch.app")).toBeVisible();
    expect(screen.getByRole("link", { name: "Hàng đợi xét duyệt" })).toHaveAttribute(
      "href",
      "/admin/legal",
    );
    expect(screen.getByRole("link", { name: "Audit log" })).toHaveAttribute("href", "/admin/audit");
    expect(screen.getByRole("link", { name: "Audit log" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Metrics" })).toHaveAttribute("href", "/admin/metrics");
    expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("href", "/admin/logs");
    expect(screen.getByRole("link", { name: "Đăng xuất" })).toHaveAttribute(
      "href",
      "/cdn-cgi/access/logout",
    );
    expect(screen.getByText("Page content")).toBeVisible();
  });
});
