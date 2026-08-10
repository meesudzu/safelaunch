import type { AdminAuditEventDto, AdminAuditFilters } from "../../../lib/api-client";
import { createApiClient } from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";

interface AuditPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
};

const formatDateTimeInput = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 16);
};

const decisionLabel = (decision: AdminAuditEventDto["decision"]): string =>
  messages[`audit.${decision}`];

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const raw = (await searchParams) ?? {};
  const from = one(raw.from);
  const to = one(raw.to);
  const actor = one(raw.actor);
  const cursor = one(raw.cursor);
  const decision = one(raw.decision);
  const filters: AdminAuditFilters = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actor ? { actor } : {}),
    ...(cursor ? { cursor } : {}),
    ...(decision === "approved" || decision === "rejected" || decision === "pending"
      ? { decision }
      : {}),
  };
  const client = createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN });
  let events: AdminAuditEventDto[] = [];
  let nextCursor: string | null = null;
  let resolvedFrom = filters.from;
  let error: string | null = null;
  try {
    const page = await client.listAdminAudit(filters);
    events = page.items;
    nextCursor = page.nextCursor;
    resolvedFrom = page.window.from;
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Không thể tải nhật ký xét duyệt";
  }

  const nextParams = new URLSearchParams();
  const nextEntries: Array<[keyof AdminAuditFilters, string | undefined]> = [
    ["from", resolvedFrom],
    ["to", filters.to],
    ["actor", filters.actor],
    ["decision", filters.decision],
    ["cursor", nextCursor ?? undefined],
  ];
  for (const [key, value] of nextEntries) {
    if (value) nextParams.set(key, value);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-6 font-serif text-2xl font-semibold">{messages["audit.title"]}</h1>
      <div>
        <form
          method="get"
          className="grid gap-4 rounded-md border border-rule bg-surface p-4 md:grid-cols-5"
        >
          <label className="text-sm">
            <span className="mb-1 block text-ink-soft">{messages["audit.from"]}</span>
            <input
              name="from"
              type="datetime-local"
              defaultValue={formatDateTimeInput(filters.from)}
              className="w-full rounded-sm border border-rule bg-bg px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-soft">{messages["audit.to"]}</span>
            <input
              name="to"
              type="datetime-local"
              defaultValue={formatDateTimeInput(filters.to)}
              className="w-full rounded-sm border border-rule bg-bg px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-soft">{messages["audit.actor"]}</span>
            <input
              name="actor"
              type="email"
              defaultValue={filters.actor}
              className="w-full rounded-sm border border-rule bg-bg px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-soft">{messages["audit.decision"]}</span>
            <select
              name="decision"
              defaultValue={filters.decision ?? ""}
              className="w-full rounded-sm border border-rule bg-bg px-2 py-1.5"
            >
              <option value="">{messages["audit.all"]}</option>
              <option value="approved">{messages["audit.approved"]}</option>
              <option value="rejected">{messages["audit.rejected"]}</option>
              <option value="pending">{messages["audit.pending"]}</option>
            </select>
          </label>
          <button
            type="submit"
            className="self-end rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-white"
          >
            {messages["audit.filter"]}
          </button>
        </form>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
          >
            {error}
          </p>
        ) : events.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">{messages["audit.empty"]}</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-md border border-rule bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-4 py-3">{messages["audit.time"]}</th>
                  <th className="px-4 py-3">{messages["audit.actor"]}</th>
                  <th className="px-4 py-3">{messages["audit.document"]}</th>
                  <th className="px-4 py-3">{messages["audit.decision"]}</th>
                  <th className="px-4 py-3">{messages["audit.reason"]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{event.actor}</td>
                    <td className="px-4 py-3">
                      <a
                        className="font-semibold text-accent hover:underline"
                        href={`/admin/legal/${encodeURIComponent(event.documentId)}`}
                      >
                        {event.documentTitle ?? event.documentId}
                      </a>
                      {event.jurisdiction ? (
                        <span className="ml-2 text-xs text-ink-soft">{event.jurisdiction}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{decisionLabel(event.decision)}</td>
                    <td className="max-w-md whitespace-pre-wrap px-4 py-3">{event.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextCursor ? (
          <a
            className="mt-5 inline-flex rounded-sm border border-rule px-3 py-2 text-sm font-semibold text-accent"
            href={`/admin/audit?${nextParams.toString()}`}
          >
            {messages["audit.next"]}
          </a>
        ) : null}
      </div>
    </main>
  );
}
