import { createApiClient, type AuditEventDto } from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";
import type { AuditEventsQuery } from "../../../lib/api-client";

type SearchParams = Record<string, string | string[] | undefined>;

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const startOfDayIso = (date: string | undefined): string | undefined =>
  date ? new Date(`${date}T00:00:00.000Z`).toISOString() : undefined;

const endOfDayIso = (date: string | undefined): string | undefined =>
  date ? new Date(`${date}T23:59:59.999Z`).toISOString() : undefined;

const decisionParam = (
  decision: string | undefined,
): "approved" | "rejected" | "pending" | undefined => {
  if (decision === "approved" || decision === "rejected" || decision === "pending") {
    return decision;
  }
  return undefined;
};

const dateInputValue = (value: string | undefined): string =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const actor = firstParam(params.actor);
  const decision = decisionParam(firstParam(params.decision));
  const fromDate = firstParam(params.from);
  const toDate = firstParam(params.to);
  const cursor = firstParam(params.cursor);

  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let events: AuditEventDto[] = [];
  let nextCursor: string | null = null;
  let error: string | null = null;
  try {
    const auditQuery: AuditEventsQuery = { limit: 50 };
    const from = startOfDayIso(fromDate);
    const to = endOfDayIso(toDate);
    if (actor) auditQuery.actor = actor;
    if (decision) auditQuery.decision = decision;
    if (from) auditQuery.from = from;
    if (to) auditQuery.to = to;
    if (cursor) auditQuery.cursor = cursor;

    const response = await client.listAuditEvents(auditQuery);
    events = response.events;
    nextCursor = response.nextCursor;
  } catch (cause: unknown) {
    if (cause instanceof Error && /403|401/.test(cause.message)) {
      error = messages["review.access_required"];
    } else {
      error = cause instanceof Error ? cause.message : "Failed to load audit log";
    }
  }

  const nextParams = new URLSearchParams();
  if (actor) nextParams.set("actor", actor);
  if (decision) nextParams.set("decision", decision);
  if (fromDate) nextParams.set("from", fromDate);
  if (toDate) nextParams.set("to", toDate);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <main className="bg-bg text-ink font-sans">
      <header className="border-b border-rule px-6 py-5">
        <h1 className="font-serif text-2xl font-semibold">{messages["audit.title"]}</h1>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <form className="grid gap-3 md:grid-cols-5" action="/admin/audit">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages["audit.from"]}
            <input
              className="rounded-sm border border-rule bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
              type="date"
              name="from"
              defaultValue={dateInputValue(fromDate)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages["audit.to"]}
            <input
              className="rounded-sm border border-rule bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
              type="date"
              name="to"
              defaultValue={dateInputValue(toDate)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-ink-soft md:col-span-2">
            {messages["audit.actor"]}
            <input
              className="rounded-sm border border-rule bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
              name="actor"
              defaultValue={actor ?? ""}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages["audit.decision"]}
            <select
              className="rounded-sm border border-rule bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
              name="decision"
              defaultValue={decision ?? ""}
            >
              <option value="">{messages["audit.all_decisions"]}</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="pending">pending</option>
            </select>
          </label>
          <button
            className="w-fit rounded-sm border border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent md:self-end"
            type="submit"
          >
            {messages["audit.filter"]}
          </button>
        </form>

        {error ? (
          <p
            role="alert"
            data-testid="admin-error"
            className="mt-4 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
          >
            {error}
          </p>
        ) : events.length === 0 ? (
          <p data-testid="audit-empty" className="mt-6 text-sm text-ink-soft">
            {messages["audit.empty"]}
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto border border-rule bg-surface">
            <table aria-label="Audit log" className="min-w-full text-left text-sm">
              <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-3 py-2">{messages["audit.created_at"]}</th>
                  <th className="px-3 py-2">{messages["audit.actor"]}</th>
                  <th className="px-3 py-2">{messages["audit.document"]}</th>
                  <th className="px-3 py-2">{messages["audit.jurisdiction"]}</th>
                  <th className="px-3 py-2">{messages["audit.decision"]}</th>
                  <th className="px-3 py-2">{messages["audit.reason"]}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-rule last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-3 text-ink-soft">
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{event.actor}</td>
                    <td className="px-3 py-3 font-medium">{event.documentTitle}</td>
                    <td className="px-3 py-3">{event.jurisdiction}</td>
                    <td className="px-3 py-3">{event.decision}</td>
                    <td className="px-3 py-3">{event.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextCursor ? (
          <a
            className="mt-4 inline-flex w-fit rounded-sm border border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
            href={`/admin/audit?${nextParams.toString()}`}
          >
            {messages["audit.next"]}
          </a>
        ) : null}
      </div>
      <footer className="border-t border-rule px-6 py-4 text-xs text-ink-soft">
        {messages["footer.disclosure"]}
      </footer>
    </main>
  );
}
