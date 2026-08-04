import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RedeemCodesClient } from "./redeem-codes-client";

describe("RedeemCodesClient", () => {
  it("renders the create form", () => {
    render(<RedeemCodesClient locale="vi" />);
    expect(screen.getByTestId("create-btn")).toBeInTheDocument();
    expect(screen.getByTestId("redeem-label")).toBeInTheDocument();
    expect(screen.getByTestId("redeem-expiry")).toBeInTheDocument();
  });

  it("does not show the latest-code panel before creating", () => {
    render(<RedeemCodesClient locale="vi" />);
    expect(screen.queryByTestId("latest-code")).toBeNull();
  });
});
