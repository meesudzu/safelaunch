import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LegalReviewForm,
  type PendingLegalDocument,
} from "./legal-review-form";

const enMessages = {
  title: 'Review legal document',
  source: 'Source URL',
  retrievedAt: 'Retrieved',
  sourceHash: 'Source hash',
  effectiveFrom: 'Effective from',
  effectiveTo: 'Effective to',
  provisions: 'Parsed provisions',
  relations: 'Document relations',
  audit: 'Audit history',
  reason: 'Reason',
  approve: 'Approve',
  reject: 'Reject',
  reasonRequired: 'A reason is required before submitting this decision.',
  submitting: 'Submitting…',
} as const;

const pendingDocument: PendingLegalDocument = {
  id: "doc-1",
  jurisdiction: "VN",
  sourceUrl: "https://vbpl.vn/abc",
  title: "Nghị định 13/2023",
  retrievedAt: "2025-01-01T00:00:00.000Z",
  sourceHash: "abc123",
  effectiveFrom: "2023-07-01T00:00:00.000Z",
  effectiveTo: null,
  provisions: [
    {
      id: "p-1",
      article: "Điều 1",
      clause: null,
      text: "Quy định về bảo vệ dữ liệu cá nhân.",
      categories: ["online_game"],
    },
  ],
  relations: [],
  audit: [
    {
      actor: "admin@safelaunch.test",
      decision: "pending",
      reason: "Initial import",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ],
};

describe("LegalReviewForm", () => {
  it("requires a reason before approval", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve());
    render(<LegalReviewForm document={pendingDocument} submit={submit} messages={enMessages} />);
    await user.click(screen.getByRole("button", { name: /approve/i }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
  });

  it("requires a reason before rejection", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve());
    render(<LegalReviewForm document={pendingDocument} submit={submit} messages={enMessages} />);
    await user.click(screen.getByRole("button", { name: /reject/i }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
  });

  it("calls submit with approve + reason once both are provided", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve());
    render(<LegalReviewForm document={pendingDocument} submit={submit} messages={enMessages} />);
    await user.type(screen.getByLabelText(/reason/i), "Văn bản còn hiệu lực.");
    await user.click(screen.getByRole("button", { name: /approve/i }));
    expect(submit).toHaveBeenCalledWith({
      decision: "approve",
      reason: "Văn bản còn hiệu lực.",
    });
  });

  it("calls submit with reject + reason once both are provided", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve());
    render(<LegalReviewForm document={pendingDocument} submit={submit} messages={enMessages} />);
    await user.type(screen.getByLabelText(/reason/i), "Trích dẫn không rõ ràng.");
    await user.click(screen.getByRole("button", { name: /reject/i }));
    expect(submit).toHaveBeenCalledWith({
      decision: "reject",
      reason: "Trích dẫn không rõ ràng.",
    });
  });

  it("renders the source URL, hash, and provisions so reviewers can audit", () => {
    render(<LegalReviewForm document={pendingDocument} submit={vi.fn(() => Promise.resolve())} messages={enMessages} />);
    expect(screen.getByText(/vbpl\.vn\/abc/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.getByText(/Điều 1/)).toBeInTheDocument();
    expect(screen.getByText(/Quy định về bảo vệ dữ liệu cá nhân/)).toBeInTheDocument();
  });

  it("renders the audit history so reviewers can see prior decisions", () => {
    render(<LegalReviewForm document={pendingDocument} submit={vi.fn(() => Promise.resolve())} messages={enMessages} />);
    expect(screen.getByText(/Initial import/i)).toBeInTheDocument();
    expect(screen.getByText(/admin@safelaunch\.test/)).toBeInTheDocument();
  });

  it("rejects whitespace-only reasons as missing", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve());
    render(<LegalReviewForm document={pendingDocument} submit={submit} messages={enMessages} />);
    await user.type(screen.getByLabelText(/reason/i), "   ");
    await user.click(screen.getByRole("button", { name: /approve/i }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
  });
});
