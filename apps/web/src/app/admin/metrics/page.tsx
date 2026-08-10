import {
  createApiClient,
  type AdminComplianceMetricsDto,
  type AdminUsageMetricsDto,
} from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";

const cards: Array<
  [
    keyof Pick<AdminUsageMetricsDto, "scans" | "uniqueSites" | "reportsOpened" | "activeReviewers">,
    string,
  ]
> = [
  ["scans", messages["metrics.scans"]],
  ["uniqueSites", messages["metrics.sites"]],
  ["reportsOpened", messages["metrics.reports"]],
  ["activeReviewers", messages["metrics.reviewers"]],
];

const severityLabel = (severity: "pass" | "review" | "high"): string =>
  ({
    pass: messages["metrics.pass"],
    review: messages["metrics.review"],
    high: messages["metrics.high"],
  })[severity];

export default async function AdminMetricsPage() {
  const client = createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN });
  let metrics: AdminUsageMetricsDto | null = null;
  let compliance: AdminComplianceMetricsDto | null = null;
  let error: string | null = null;
  try {
    [metrics, compliance] = await Promise.all([
      client.getAdminUsageMetrics(),
      client.getAdminComplianceMetrics(),
    ]);
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Không thể tải metrics";
  }
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="font-serif text-2xl font-semibold">{messages["metrics.title"]}</h1>
      <p className="mt-1 text-sm text-ink-soft">{messages["metrics.window"]}</p>
      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      ) : null}
      {metrics ? (
        <>
          <section
            aria-label={messages["metrics.title"]}
            className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {cards.map(([key, label]) => {
              const item = metrics[key];
              return (
                <article key={key} className="rounded-md border border-rule bg-surface p-5">
                  <h2 className="text-sm text-ink-soft">{label}</h2>
                  <p className="mt-2 font-serif text-4xl font-semibold">{item.value}</p>
                  <p className="mt-2 text-xs text-ink-soft">
                    {messages["metrics.previous"]}: {item.previous} · {item.delta >= 0 ? "+" : ""}
                    {item.delta}
                  </p>
                </article>
              );
            })}
          </section>
          {!metrics.uniqueSitesComplete ? (
            <p className="mt-5 text-sm text-ink-soft">{messages["metrics.incomplete"]}</p>
          ) : null}
        </>
      ) : null}
      {compliance ? (
        <section id="compliance" className="mt-12 scroll-mt-6">
          <h2 className="font-serif text-xl font-semibold">{messages["metrics.compliance"]}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Rubric: {compliance.version?.rule_version_id ?? "—"}
          </p>
          {compliance.categories.length === 0 ? (
            <p className="mt-5 text-sm text-ink-soft">{messages["metrics.no_data"]}</p>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-md border border-rule bg-surface">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-rule">
                  <tr>
                    <th className="px-4 py-3">Category</th>
                    {compliance.severityOrder.map((severity) => (
                      <th key={severity} className="px-4 py-3">
                        {severityLabel(severity)}
                      </th>
                    ))}
                    <th className="px-4 py-3">{messages["metrics.median"]}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {compliance.categories.map((row) => (
                    <tr key={row.category}>
                      <th className="px-4 py-3 font-mono">{row.category}</th>
                      {compliance.severityOrder.map((severity) => (
                        <td key={severity} className="px-4 py-3">
                          {row.counts[severity]}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {row.medianSeverity ? severityLabel(row.medianSeverity) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
