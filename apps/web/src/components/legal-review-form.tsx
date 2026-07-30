"use client";

import { useState } from "react";

export type LegalProvisionCard = {
  readonly id: string;
  readonly article: string;
  readonly clause: string | null;
  readonly text: string;
  readonly categories: readonly string[];
};

export type LegalRelationCard = {
  readonly id: string;
  readonly type: "amends" | "supplements" | "replaces" | "repeals";
  readonly targetDocumentId: string;
};

export type LegalAuditEvent = {
  readonly actor: string;
  readonly decision: "pending" | "approved" | "rejected";
  readonly reason: string;
  readonly createdAt: string;
};

export type PendingLegalDocument = {
  readonly id: string;
  readonly jurisdiction: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly retrievedAt: string;
  readonly sourceHash: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly provisions: readonly LegalProvisionCard[];
  readonly relations: readonly LegalRelationCard[];
  readonly audit: readonly LegalAuditEvent[];
};

export type ReviewDecision = "approve" | "reject";

export type ReviewSubmission = {
  readonly decision: ReviewDecision;
  readonly reason: string;
};

export interface LegalReviewMessages {
  readonly title: string;
  readonly source: string;
  readonly retrievedAt: string;
  readonly sourceHash: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly provisions: string;
  readonly relations: string;
  readonly audit: string;
  readonly reason: string;
  readonly approve: string;
  readonly reject: string;
  readonly reasonRequired: string;
  readonly submitting: string;
}

export interface LegalReviewFormProps {
  readonly locale: "vi" | "en";
  readonly messages: LegalReviewMessages;
  readonly document: PendingLegalDocument;
  readonly submit: (input: ReviewSubmission) => Promise<void>;
}

const formatDate = (iso: string, locale: "vi" | "en"): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

export const LegalReviewForm = ({ locale, messages, document, submit }: LegalReviewFormProps) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);

  const handleSubmit = async (event: { preventDefault: () => void }, decision: ReviewDecision) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(messages.reasonRequired);
      return;
    }
    setError(null);
    setSubmitting(decision);
    try {
      await submit({ decision, reason: trimmed });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section
      aria-labelledby="review-title"
      data-locale={locale}
      data-document-id={document.id}
      className="bg-bg text-ink font-sans antialiased"
    >
      <h1
        id="review-title"
        className="font-serif text-3xl font-semibold leading-tight md:text-4xl"
      >
        {document.title}
      </h1>
      <dl className="mt-6 flex flex-col gap-3 text-sm">
        <Field label={messages.source} value={document.sourceUrl} />
        <Field label={messages.retrievedAt} value={formatDate(document.retrievedAt, locale)} />
        <Field label={messages.sourceHash} value={document.sourceHash} mono />
        <Field
          label={messages.effectiveFrom}
          value={document.effectiveFrom ? formatDate(document.effectiveFrom, locale) : "—"}
        />
        <Field
          label={messages.effectiveTo}
          value={document.effectiveTo ? formatDate(document.effectiveTo, locale) : "—"}
        />
      </dl>

      <section className="mt-8" aria-labelledby="provisions-heading">
        <h2 id="provisions-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          {messages.provisions}
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {document.provisions.map((provision) => (
            <li
              key={provision.id}
              data-provision-id={provision.id}
              className="rounded-md border border-rule bg-surface p-4"
            >
              <p className="text-sm font-semibold">
                {provision.article}
                {provision.clause ? ` ${provision.clause}` : ""}
              </p>
              <p className="mt-1 text-sm text-ink">{provision.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="relations-heading">
        <h2 id="relations-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          {messages.relations}
        </h2>
        {document.relations.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">—</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {document.relations.map((rel) => (
              <li key={rel.id} data-relation-id={rel.id}>
                {rel.type} → {rel.targetDocumentId}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="audit-heading">
        <h2 id="audit-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          {messages.audit}
        </h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {document.audit.map((event, index) => (
            <li
              key={`${event.actor}-${event.createdAt}-${index}`}
              data-audit-event="true"
              className="rounded-sm border border-rule bg-surface px-3 py-2"
            >
              <p className="text-xs uppercase tracking-wider text-ink-soft">
                {event.decision} · {formatDate(event.createdAt, locale)}
              </p>
              <p className="mt-1 text-sm">{event.reason}</p>
              <p className="mt-1 text-xs text-ink-soft">{event.actor}</p>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="mt-8 flex flex-col gap-4 rounded-md border border-rule bg-surface p-5"
        aria-label={messages.title}
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages.reason}
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="min-w-0 rounded-sm border border-rule bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        {error ? (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={(event) => {
              void handleSubmit(event, "reject");
            }}
            className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm border border-rule px-4 py-2 text-sm font-semibold text-error transition-colors hover:bg-rule/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/30 disabled:opacity-60 md:w-auto"
          >
            {submitting === "reject" ? "…" : messages.reject}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={(event) => {
              void handleSubmit(event, "approve");
            }}
            className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 md:w-auto"
          >
            {submitting === "approve" ? "…" : messages.approve}
          </button>
        </div>
      </form>
    </section>
  );
};

const Field = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-3">
    <dt className="w-44 shrink-0 text-xs uppercase tracking-wider text-ink-soft">{label}</dt>
    <dd className={mono ? "font-mono text-sm break-all" : "text-sm"}>{value}</dd>
  </div>
);
