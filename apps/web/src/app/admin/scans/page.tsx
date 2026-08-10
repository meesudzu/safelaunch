import { createApiClient, type AdminScanSummaryDto } from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";
import { LiveRefresh } from "./live-refresh";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
export default async function AdminScansPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams) ?? {};
  const filters = {
    state: one(raw.state),
    category: one(raw.category),
    jurisdiction: one(raw.jurisdiction),
    from: one(raw.from),
    to: one(raw.to),
    cursor: one(raw.cursor),
    live: one(raw.live),
  };
  const client = createApiClient({ NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN });
  let page: {
    items: AdminScanSummaryDto[];
    nextCursor: string | null;
    window: { from: string; to: string | null };
  } | null = null;
  let error: string | null = null;
  try {
    page = await client.listAdminScans(filters);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không thể tải lượt quét";
  }
  const live = filters.live === "true";
  const hasLive = Boolean(
    page?.items.some((item) => !["completed", "partial", "failed"].includes(item.state)),
  );
  const next = new URLSearchParams();
  Object.entries({
    ...filters,
    from: page?.window.from,
    cursor: page?.nextCursor ?? undefined,
  }).forEach(([key, value]) => {
    if (value) next.set(key, value);
  });
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <LiveRefresh enabled={live && hasLive} />
      <h1 className="font-serif text-2xl font-semibold">{messages["scans.title"]}</h1>
      <form method="get" className="mt-6 flex flex-wrap gap-3">
        <select
          name="state"
          defaultValue={filters.state ?? ""}
          className="border border-rule bg-surface px-3 py-2"
        >
          <option value="">{messages["scans.all"]}</option>
          {[
            "queued",
            "fetching",
            "extracting",
            "retrieving",
            "evaluating",
            "reporting",
            "completed",
            "partial",
            "failed",
          ].map((state) => (
            <option key={state}>{state}</option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={filters.category ?? ""}
          className="border border-rule bg-surface px-3 py-2"
        >
          <option value="">Category</option>
          {["online_game", "electronic_press", "digital_entertainment"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="live" value="true" defaultChecked={live} />
          {messages["scans.live"]}
        </label>
        <button className="bg-accent px-4 py-2 text-white">{messages["scans.filter"]}</button>
      </form>
      {error ? (
        <p role="alert" className="mt-5 text-error">
          {error}
        </p>
      ) : null}
      {page?.items.length === 0 ? (
        <p className="mt-6 text-ink-soft">{messages["scans.empty"]}</p>
      ) : null}
      {page?.items.length ? (
        <div className="mt-6 overflow-x-auto rounded-md border border-rule bg-surface">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead>
              <tr>
                {[
                  "Created",
                  "Scan ID",
                  "URL hash",
                  "Jurisdiction",
                  "Category",
                  "State",
                  "Pages",
                  "Expires",
                ].map((h) => (
                  <th key={h} className="px-3 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3">{new Date(item.createdAt).toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-3">
                    <a className="text-accent" href={`/admin/scans/${item.id}`}>
                      {item.id}
                    </a>
                  </td>
                  <td className="px-3 py-3 font-mono">{item.urlHash ?? "—"}</td>
                  <td className="px-3 py-3">{item.jurisdiction}</td>
                  <td className="px-3 py-3">{item.category}</td>
                  <td className="px-3 py-3">{item.state}</td>
                  <td className="px-3 py-3">
                    {item.pagesDone}/{item.pagesTotal}
                  </td>
                  <td className="px-3 py-3">{new Date(item.expiresAt).toLocaleString("vi-VN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {page?.nextCursor ? (
        <a className="mt-5 inline-flex text-accent" href={`/admin/scans?${next}`}>
          {messages["scans.next"]}
        </a>
      ) : null}
    </main>
  );
}
