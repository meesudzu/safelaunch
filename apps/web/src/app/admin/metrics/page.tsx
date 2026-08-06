import {
  createApiClient,
  type ComplianceMetricsDto,
  type UsageMetricTileDto,
} from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";

const formatNumber = (value: number): string => new Intl.NumberFormat("vi-VN").format(value);

const deltaText = (delta: number | undefined): string | null => {
  if (delta === undefined) return null;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatNumber(delta)} vs previous 24h`;
};

function MetricTile({ tile }: { tile: UsageMetricTileDto }) {
  const delta = deltaText(tile.delta);
  return (
    <section className="border border-rule bg-surface p-4" aria-label={tile.label}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{tile.label}</p>
      <p className="mt-3 font-serif text-3xl font-semibold">{formatNumber(tile.value)}</p>
      {delta ? <p className="mt-2 text-xs text-ink-soft">{delta}</p> : null}
    </section>
  );
}

function ComplianceDistribution({ metrics }: { metrics: ComplianceMetricsDto }) {
  return (
    <section id="compliance" className="mt-8">
      <h2 className="font-serif text-xl font-semibold">{messages["metrics.compliance_title"]}</h2>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            {messages["metrics.severity_histogram"]}
          </h3>
          <div className="mt-3 overflow-x-auto border border-rule bg-surface">
            <table aria-label="Severity histogram" className="min-w-full text-left text-sm">
              <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-3 py-2">{messages["metrics.severity"]}</th>
                  <th className="px-3 py-2">{messages["metrics.count"]}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.severityHistogram.map((row) => (
                  <tr key={row.severity} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-3">{row.severity}</td>
                    <td className="px-3 py-3">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            {messages["metrics.category_severity"]}
          </h3>
          <div className="mt-3 overflow-x-auto border border-rule bg-surface">
            <table aria-label="Category severity" className="min-w-full text-left text-sm">
              <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-3 py-2">{messages["metrics.category"]}</th>
                  <th className="px-3 py-2">high</th>
                  <th className="px-3 py-2">review</th>
                  <th className="px-3 py-2">pass</th>
                </tr>
              </thead>
              <tbody>
                {metrics.categorySeverity.map((row) => (
                  <tr key={row.category} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-3">{row.category}</td>
                    <td className="px-3 py-3">{row.high}</td>
                    <td className="px-3 py-3">{row.review}</td>
                    <td className="px-3 py-3">{row.pass}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function MetricsPage() {
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let metrics: Awaited<ReturnType<typeof client.getUsageMetrics>> | null = null;
  let complianceMetrics: ComplianceMetricsDto | null = null;
  let error: string | null = null;
  try {
    [metrics, complianceMetrics] = await Promise.all([
      client.getUsageMetrics(),
      client.getComplianceMetrics(),
    ]);
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Failed to load metrics";
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{messages["metrics.title"]}</h1>
          <p className="mt-2 text-sm text-ink-soft">{messages["metrics.usage_window"]}</p>
        </div>
        {metrics ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages["metrics.generated_at"]}{" "}
            {new Date(metrics.generatedAt).toLocaleString("vi-VN")}
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
      ) : metrics ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.tiles.map((tile) => (
              <MetricTile key={tile.key} tile={tile} />
            ))}
          </div>
          {complianceMetrics ? <ComplianceDistribution metrics={complianceMetrics} /> : null}
        </>
      ) : null}
    </div>
  );
}
