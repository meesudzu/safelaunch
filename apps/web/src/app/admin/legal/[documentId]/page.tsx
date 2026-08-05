import {
  LegalReviewForm,
  type PendingLegalDocument,
  type ReviewSubmission,
} from "../../../../components/legal-review-form";
import messages from "../../../../messages/admin-vi.json";
import { createApiClient, type PendingLegalDocumentDto } from "../../../../lib/api-client";

const toPending = (dto: PendingLegalDocumentDto): PendingLegalDocument => ({
  id: dto.id,
  jurisdiction: dto.jurisdiction,
  sourceUrl: dto.sourceUrl,
  title: dto.title,
  retrievedAt: dto.retrievedAt,
  sourceHash: dto.sourceHash,
  effectiveFrom: dto.effectiveFrom,
  effectiveTo: dto.effectiveTo,
  provisions: dto.provisions.map((provision) => ({
    id: provision.id,
    article: provision.article,
    clause: provision.clause,
    text: provision.text,
    categories: provision.categories,
  })),
  relations: dto.relations.map((relation) => ({
    id: relation.id,
    type: relation.type as "amends" | "supplements" | "replaces" | "repeals",
    targetDocumentId: relation.targetDocumentId,
  })),
  audit: dto.audit.map((event) => ({
    actor: event.actor,
    decision: event.decision as "pending" | "approved" | "rejected",
    reason: event.reason,
    createdAt: event.createdAt,
  })),
});

export default async function LegalReviewPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });
  let document: PendingLegalDocument | null = null;
  let notFound = false;
  let accessDenied = false;
  try {
    const dto = await client.getPendingDocument(documentId);
    document = dto ? toPending(dto) : null;
    notFound = dto === null;
  } catch (cause: unknown) {
    if (cause instanceof Error && /403|401/.test(cause.message)) {
      accessDenied = true;
    } else {
      throw cause;
    }
  }
  if (accessDenied) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-serif text-2xl font-semibold">{messages.title}</h1>
        <p
          role="alert"
          data-testid="admin-error"
          className="mt-4 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
        >
          {messages["review.access_required"]}
        </p>
        <a
          href="/admin/legal"
          className="mt-6 inline-flex w-fit rounded-sm border border-rule px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
        >
          {messages["review.back"]}
        </a>
      </main>
    );
  }
  if (notFound || !document) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-serif text-2xl font-semibold">{messages["review.title"]}</h1>
        <p data-testid="document-not-found" className="mt-4 text-sm text-ink-soft">
          {messages["review.not_found"]}
        </p>
        <a
          href="/admin/legal"
          className="mt-6 inline-flex w-fit rounded-sm border border-rule px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
        >
          {messages["review.back"]}
        </a>
      </main>
    );
  }

  async function submitReviewAction(submission: ReviewSubmission): Promise<void> {
    "use server";
    if (document) {
      await client.submitReview(document.id, submission);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <a
          href="/admin/legal"
          className="text-xs font-semibold uppercase tracking-wider text-accent hover:underline"
        >
          {messages["review.back"]}
        </a>
      </div>
      <div>
        <LegalReviewForm
          messages={{
            title: messages["review.title"],
            source: messages["list.document"] + " URL",
            retrievedAt: messages["list.retrieved"],
            sourceHash: "Source hash",
            effectiveFrom: "Effective from",
            effectiveTo: "Effective to",
            provisions: "Parsed provisions",
            relations: "Document relations",
            audit: "Audit history",
            reason: "Reason",
            approve: "Approve",
            reject: "Reject",
            reasonRequired: "A reason is required before submitting this decision.",
            submitting: "Submitting…",
          }}
          document={document}
          submit={submitReviewAction}
        />
      </div>
    </main>
  );
}
