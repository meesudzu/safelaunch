import { createApiClient, type AdminHealthDto } from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";

const labels: Record<string, string> = {
  d1: "D1",
  r2: "R2",
  vectorize: "Vectorize",
  queue: "Queue",
  workflow: "Workflow",
  durableObject: "Durable Object",
  workersAi: "Workers AI",
};

export default async function AdminHealthPage() {
  const client = createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN });
  let health: AdminHealthDto | null = null;
  let error: string | null = null;
  try {
    health = await client.getAdminHealth();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không thể tải trạng thái";
  }
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="font-serif text-2xl font-semibold">{messages["health.title"]}</h1>
      {error ? (
        <p role="alert" className="mt-5 text-error">
          {error}
        </p>
      ) : null}
      {health ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(health.sections).map(([key, section]) => (
            <article key={key} className="rounded-md border border-rule bg-surface p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg font-semibold">{labels[key] ?? key}</h2>
                <span className="text-xs font-semibold uppercase text-ink-soft">
                  {messages[`health.${section.status}`]}
                </span>
              </div>
              {section.metrics ? (
                <dl className="mt-4 space-y-2 text-sm">
                  {Object.entries(section.metrics).map(([name, value]) => (
                    <div key={name} className="flex justify-between gap-4">
                      <dt className="text-ink-soft">{name}</dt>
                      <dd className="font-mono text-right">{value ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-4 text-sm text-ink-soft">{section.reason}</p>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
