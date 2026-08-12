import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ContactPage from "./contact/page";
import PolicyPage from "./policy/page";
import TermsPage from "./term/page";

describe("marketing document pages", () => {
  it.each([
    [TermsPage, "Điều khoản dịch vụ"],
    [PolicyPage, "Chính sách bảo mật"],
    [ContactPage, "Liên hệ"],
  ])("renders %s in Vietnamese", async (Page, heading) => {
    render(await Page({ params: Promise.resolve({ locale: "vi" }) }));
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /SafeLaunch AI/ })[0]).toHaveAttribute(
      "href",
      "/vi",
    );
  });
});
