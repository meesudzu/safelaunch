import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminLayout from "./layout";

vi.mock("next/headers", () => ({
  headers: () => new Headers({ "cf-access-authenticated-user-email": "reviewer@safelaunch.test" }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/audit" }));

describe("admin layout", () => {
  it("shows Access identity, logout, navigation, and active route", () => {
    render(
      <AdminLayout>
        <p>Nội dung trang</p>
      </AdminLayout>,
    );

    expect(screen.getByText("reviewer@safelaunch.test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Đăng xuất" })).toHaveAttribute(
      "href",
      "/cdn-cgi/access/logout",
    );
    expect(screen.getByRole("link", { name: "Nhật ký xét duyệt" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Metrics")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Nội dung trang")).toBeInTheDocument();
  });
});
