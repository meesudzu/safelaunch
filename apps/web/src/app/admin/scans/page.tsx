import {
  createApiClient,
  type AdminScansQuery,
  type AdminScanSummaryDto,
} from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";
import { LiveRefresh } from "./live-refresh";

type SearchParams = Record<string, string | string[] | undefined>;

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

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

const buildQuery = (params: SearchParams): AdminScansQuery => {
  const live = firstParam(params.live) !== "false";
  const query: AdminScansQuery = { live, limit: 100 };
  if (!live) {
    const state = firstParam(params.state);
    const jurisdiction = firstParam(params.jurisdiction);
    const category = firstParam(params.category);
    const from = firstParam(params.from);
    const to = firstParam(params.to);
    if (state) query.state = state;
    if (jurisdiction) query.jurisdiction = jurisdiction;
    if (category) query.category = category;
    if (from) query.from = from;
    if (to) query.to = to;
  }
  return query;
};

function ScanRow({ scan }: { scan: AdminScanSummaryDto }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="whitespace-nowrap px-3 py-3 text-ink-soft">
        {formatDateTime(scan.createdAt)}
      </td>
      <td className="px-3 py-3 font-mono text-xs">
        <a className="text-accent hover:underline" href={`/admin/scans/${scan.scanId}`}>
          {scan.scanId}
        </a>
      </td>
      <td className="px-3 py-3">{scan.jurisdiction}</td>
      <td className="px-3 py-3">{scan.category}</td>
      <td className="px-3 py-3">{scan.state}</td>
      <td className="px-3 py-3">
        {scan.pagesDone}/{scan.totalPages}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-ink-soft">
        {formatDateTime(scan.expiresAt)}
      </td>
      <td className="px-3 py-3 font-mono text-xs">{scan.urlHashPrefix}</td>
    </tr>
  );
}

export default async function ScansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = buildQuery(params);
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let scans: AdminScanSummaryDto[] = [];
  let error: string | null = null;
  try {
    scans = (await client.listAdminScans(query)).scans;
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Failed to load scans";
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <LiveRefresh enabled={query.live === true} />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="font-serif text-2xl font-semibold">{messages["scans.title"]}</h1>
        <form className="flex flex-wrap gap-2" action="/admin/scans">
          <select
            className="rounded-sm border border-rule bg-surface px-3 py-2 text-sm"
            name="live"
            defaultValue={String(query.live)}
          >
            <option value="true">{messages["scans.live"]}</option>
            <option value="false">{messages["scans.all"]}</option>
          </select>
          <input
            className="rounded-sm border border-rule bg-surface px-3 py-2 text-sm"
            name="state"
            placeholder={messages["scans.state"]}
            defaultValue={firstParam(params.state) ?? ""}
          />
          <button
            className="rounded-sm border border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
            type="submit"
          >
            {messages["scans.filter"]}
          </button>
        </form>
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="admin-error"
          className="mt-4 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      ) : scans.length === 0 ? (
        <p data-testid="scans-empty" className="mt-4 text-sm text-ink-soft">
          {messages["scans.empty"]}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-rule bg-surface">
          <table aria-label="Site scans" className="min-w-full text-left text-sm">
            <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
              <tr>
                <th className="px-3 py-2">{messages["scans.created_at"]}</th>
                <th className="px-3 py-2">{messages["scans.scan_id"]}</th>
                <th className="px-3 py-2">{messages["scans.jurisdiction"]}</th>
                <th className="px-3 py-2">{messages["scans.category"]}</th>
                <th className="px-3 py-2">{messages["scans.state"]}</th>
                <th className="px-3 py-2">{messages["scans.pages"]}</th>
                <th className="px-3 py-2">{messages["scans.expires_at"]}</th>
                <th className="px-3 py-2">{messages["scans.url_hash"]}</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <ScanRow key={scan.scanId} scan={scan} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
