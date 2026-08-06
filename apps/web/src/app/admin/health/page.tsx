import { createApiClient } from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";

const formatDateTime = (iso: string | null): string => {
  if (!iso) return "-";
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

export default async function HealthPage() {
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let health: Awaited<ReturnType<typeof client.getSystemHealth>> | null = null;
  let error: string | null = null;
  try {
    health = await client.getSystemHealth();
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Failed to load system health";
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <h1 className="font-serif text-2xl font-semibold">{messages["health.title"]}</h1>
        {health ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages["health.generated_at"]} {formatDateTime(health.generatedAt)}
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="admin-error"
          className="mt-4 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      ) : health ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
              {messages["health.d1_rows"]}
            </h2>
            <div className="mt-3 overflow-x-auto border border-rule bg-surface">
              <table aria-label="D1 row counts" className="min-w-full text-left text-sm">
                <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-3 py-2">{messages["health.table"]}</th>
                    <th className="px-3 py-2">{messages["health.rows"]}</th>
                  </tr>
                </thead>
                <tbody>
                  {health.d1.rowCounts.map((row) => (
                    <tr key={row.tableName} className="border-b border-rule last:border-b-0">
                      <td className="px-3 py-3">{row.tableName}</td>
                      <td className="px-3 py-3">{row.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
              {messages["health.retention"]}
            </h2>
            <dl className="mt-3 grid gap-3">
              {[
                [messages["health.oldest_scan"], formatDateTime(health.d1.retention.oldestScan)],
                [messages["health.next_purge"], formatDateTime(health.d1.retention.nextPurge)],
                [
                  messages["health.oldest_pending_review"],
                  formatDateTime(health.d1.oldestPendingReview),
                ],
              ].map(([label, value]) => (
                <div key={label} className="border border-rule bg-surface p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                    {label}
                  </dt>
                  <dd className="mt-2 text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="lg:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
              {messages["health.bindings"]}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {health.bindings.map((binding) => (
                <div key={binding.name} className="border border-rule bg-surface p-3">
                  <p className="font-mono text-xs">{binding.name}</p>
                  <p className="mt-2 text-sm">{binding.status}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
