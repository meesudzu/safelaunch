import { createApiClient, type PendingDocumentSummary } from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

export default async function LegalQueuePage() {
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });
  let pending: PendingDocumentSummary[] = [];
  let error: string | null = null;
  try {
    pending = await client.listPendingDocuments();
  } catch (cause: unknown) {
    if (cause instanceof Error && /403|401/.test(cause.message)) {
      error = messages["review.access_required"];
    } else {
      error = cause instanceof Error ? cause.message : "Failed to load queue";
    }
  }
  return (
    <main className="bg-bg text-ink font-sans">
      <header className="border-b border-rule px-6 py-5">
        <h1 className="font-serif text-2xl font-semibold">{messages.title}</h1>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          {messages["list.title"]}
        </h2>
        {error ? (
          <p
            role="alert"
            data-testid="admin-error"
            className="mt-4 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
          >
            {error}
          </p>
        ) : pending.length === 0 ? (
          <p data-testid="queue-empty" className="mt-4 text-sm text-ink-soft">
            {messages["list.empty"]}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3" data-testid="pending-list">
            {pending.map((doc) => (
              <li
                key={doc.id}
                data-document-id={doc.id}
                className="rounded-md border border-rule bg-surface p-4"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-serif text-lg font-semibold">{doc.title}</p>
                  <p className="text-xs uppercase tracking-wider text-ink-soft">
                    {messages["list.jurisdiction"]}: {doc.jurisdiction} · {messages["list.retrieved"]}:{" "}
                    {formatDate(doc.retrievedAt)}
                  </p>
                  <p className="font-mono text-xs text-ink-soft break-all">
                    {doc.sourceUrl}
                  </p>
                </div>
                <div className="mt-3 flex justify-end">
                  <a
                    href={`/admin/legal/${doc.id}`}
                    className="inline-flex w-fit rounded-sm border border-rule px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
                  >
                    {messages["list.open"]}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="border-t border-rule px-6 py-4 text-xs text-ink-soft">
        {messages["footer.disclosure"]}
      </footer>
    </main>
  );
}
