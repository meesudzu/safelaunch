import { createApiClient, type AdminScanDetailDto } from "../../../../lib/api-client";
import messages from "../../../../messages/admin-vi.json";

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

function CoverageList({ title, values }: { title: string; values: string[] }) {
  return (
    <section className="border border-rule bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{title}</p>
      {values.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">0</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {values.map((value) => (
            <li key={value} className="font-mono text-xs">
              {value}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScanDetail({ scan }: { scan: AdminScanDetailDto }) {
  const severities = Object.entries(scan.severityCounts);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <a
            className="text-xs font-semibold uppercase tracking-wider text-accent"
            href="/admin/scans"
          >
            {messages["scans.title"]}
          </a>
          <h1 className="mt-2 font-serif text-2xl font-semibold">{scan.scanId}</h1>
          <p className="mt-2 font-mono text-xs text-ink-soft">{scan.urlHashPrefix}</p>
        </div>
        {scan.reportUrl ? (
          <a
            href={scan.reportUrl}
            className="inline-flex w-fit rounded-sm border border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
          >
            {messages["scans.report"]}
          </a>
        ) : null}
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [messages["scans.jurisdiction"], scan.jurisdiction],
          [messages["scans.category"], scan.category],
          [messages["scans.state"], scan.state],
          [messages["scans.created_at"], formatDateTime(scan.createdAt)],
          [messages["scans.expires_at"], formatDateTime(scan.expiresAt)],
        ].map(([label, value]) => (
          <div key={label} className="border border-rule bg-surface p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              {label}
            </dt>
            <dd className="mt-2 text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-ink-soft">
        {messages["scans.coverage"]}
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <CoverageList title="fetched" values={scan.coverage.fetched} />
        <CoverageList title="failed" values={scan.coverage.failed} />
        <CoverageList title="skipped" values={scan.coverage.skipped} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            {messages["scans.findings"]}
          </h2>
          <div className="mt-3 overflow-x-auto border border-rule bg-surface">
            <table aria-label="Finding severity" className="min-w-full text-left text-sm">
              <tbody>
                {severities.map(([severity, count]) => (
                  <tr key={severity} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-3">{severity}</td>
                    <td className="px-3 py-3 font-serif text-xl font-semibold">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            {messages["scans.analysis_runs"]}
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {scan.analysisRuns.map((run) => (
              <div
                key={`${run.modelId}-${run.createdAt}`}
                className="border border-rule bg-surface p-4"
              >
                <p className="font-mono text-xs">{run.modelId}</p>
                <p className="mt-2 text-xs text-ink-soft">
                  {run.promptVersion} · {run.retrievalVersion} · {formatDateTime(run.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default async function ScanDetailPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let scan: AdminScanDetailDto | null = null;
  let error: string | null = null;
  try {
    scan = await client.getAdminScan(scanId);
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Failed to load scan";
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p
          role="alert"
          data-testid="admin-error"
          className="rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p data-testid="scan-not-found" className="text-sm text-ink-soft">
          {messages["scans.not_found"]}
        </p>
      </div>
    );
  }

  return <ScanDetail scan={scan} />;
}
