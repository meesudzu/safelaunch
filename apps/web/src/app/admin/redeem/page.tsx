import {
  createApiClient,
  type RedeemBatchDto,
  type RedeemInventoryTileDto,
} from "../../../lib/api-client";
import messages from "../../../messages/admin-vi.json";
import { RedeemGenerateForm } from "./redeem-generate-form";

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

function Tile({ tile }: { tile: RedeemInventoryTileDto }) {
  return (
    <section className="border border-rule bg-surface p-4" aria-label={tile.label}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{tile.label}</p>
      <p className="mt-3 font-serif text-3xl font-semibold">{tile.value}</p>
      {tile.secondaryValue !== undefined ? (
        <p className="mt-2 text-xs text-ink-soft">
          {tile.secondaryValue} {messages["redeem.last_7d"]}
        </p>
      ) : null}
    </section>
  );
}

function BatchRow({ batch }: { batch: RedeemBatchDto }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="px-3 py-3 font-medium">{batch.batchId}</td>
      <td className="whitespace-nowrap px-3 py-3 text-ink-soft">
        {formatDateTime(batch.issuedAt)}
      </td>
      <td className="px-3 py-3 font-mono text-xs">{batch.issuedBy}</td>
      <td className="px-3 py-3">{batch.total}</td>
      <td className="px-3 py-3">{batch.redeemed}</td>
      <td className="px-3 py-3">{batch.expired}</td>
      <td className="px-3 py-3">{batch.unused}</td>
    </tr>
  );
}

export default async function RedeemPage() {
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });

  let inventory: Awaited<ReturnType<typeof client.getRedeemInventory>> | null = null;
  let error: string | null = null;
  try {
    inventory = await client.getRedeemInventory();
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : "Failed to load redeem inventory";
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <h1 className="font-serif text-2xl font-semibold">{messages["redeem.title"]}</h1>
        {inventory ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            {messages["redeem.generated_at"]}{" "}
            {new Date(inventory.generatedAt).toLocaleString("vi-VN")}
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        <RedeemGenerateForm />
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="admin-error"
          className="mt-4 rounded-sm border border-error bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      ) : inventory ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {inventory.tiles.map((tile) => (
              <Tile key={tile.key} tile={tile} />
            ))}
          </div>

          {inventory.batches.length === 0 ? (
            <p data-testid="redeem-empty" className="mt-4 text-sm text-ink-soft">
              {messages["redeem.empty"]}
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto border border-rule bg-surface">
              <table aria-label="Redeem batches" className="min-w-full text-left text-sm">
                <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-3 py-2">{messages["redeem.batch"]}</th>
                    <th className="px-3 py-2">{messages["redeem.issued_at"]}</th>
                    <th className="px-3 py-2">{messages["redeem.issued_by"]}</th>
                    <th className="px-3 py-2">{messages["redeem.total"]}</th>
                    <th className="px-3 py-2">{messages["redeem.redeemed"]}</th>
                    <th className="px-3 py-2">{messages["redeem.expired"]}</th>
                    <th className="px-3 py-2">{messages["redeem.unused"]}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.batches.map((batch) => (
                    <BatchRow key={`${batch.batchId}-${batch.issuedBy}`} batch={batch} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
