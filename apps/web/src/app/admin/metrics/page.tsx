import { createApiClient, type UsageMetricTileDto } from "../../../lib/api-client";
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

export default async function MetricsPage() {
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let metrics: Awaited<ReturnType<typeof client.getUsageMetrics>> | null = null;
  let error: string | null = null;
  try {
    metrics = await client.getUsageMetrics();
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
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.tiles.map((tile) => (
            <MetricTile key={tile.key} tile={tile} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
