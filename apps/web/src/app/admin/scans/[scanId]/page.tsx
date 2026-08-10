import { createApiClient } from "../../../../lib/api-client";
import messages from "../../../../messages/admin-vi.json";
export default async function AdminScanDetailPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const client = createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN });
  const scan = await client.getAdminScan(scanId);
  if (!scan)
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <p>Không tìm thấy lượt quét.</p>
      </main>
    );
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <a href="/admin/scans" className="text-accent">
        ← {messages["scans.title"]}
      </a>
      <h1 className="mt-5 font-serif text-2xl font-semibold">{messages["scans.detail"]}</h1>
      <dl className="mt-6 grid gap-3 rounded-md border border-rule bg-surface p-5 sm:grid-cols-2">
        {Object.entries({
          id: scan.id,
          urlHash: scan.urlHash,
          jurisdiction: scan.jurisdiction,
          category: scan.category,
          state: scan.state,
          analysisVersion: scan.analysisVersion,
          createdAt: scan.createdAt,
          expiresAt: scan.expiresAt,
        }).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-ink-soft">{key}</dt>
            <dd className="font-mono text-sm">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {Object.entries(scan.coverage).map(([key, value]) => (
          <article key={key} className="border border-rule bg-surface p-4">
            <h2>{key}</h2>
            <p className="font-serif text-3xl">{value}</p>
          </article>
        ))}
      </section>
      <section className="mt-6">
        <h2 className="font-serif text-xl">Findings</h2>
        <ul>
          {scan.findingSeverities.map((item) => (
            <li key={item.severity}>
              {item.severity}: {item.count}
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="font-serif text-xl">Analysis runs</h2>
        <ul className="mt-2 space-y-2">
          {scan.analysisRuns.map((run) => (
            <li
              key={`${run.created_at}-${run.model_id}`}
              className="border border-rule bg-surface p-3 font-mono text-xs"
            >
              {run.model_id} · {run.prompt_version} · {run.retrieval_version} ·{" "}
              {run.rule_version_id}
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-6 text-sm">Report: {scan.report?.available ? "available" : "unavailable"}</p>
    </main>
  );
}
