import { createApiClient, type AdminUsageMetricsDto } from "../../../lib/api-client";
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

export default async function AdminMetricsPage() {
  const client = createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN });
  let metrics: AdminUsageMetricsDto | null = null;
  let error: string | null = null;
  try {
    metrics = await client.getAdminUsageMetrics();
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
    </main>
  );
}
