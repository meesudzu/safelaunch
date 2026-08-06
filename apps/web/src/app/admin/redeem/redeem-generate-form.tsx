"use client";

import { useState } from "react";

export function RedeemGenerateForm() {
  const [batchId, setBatchId] = useState("");
  const [count, setCount] = useState(10);
  const [expiresAt, setExpiresAt] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setCodes([]);
    try {
      const response = await fetch("/v1/admin/redeem/generate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          batchId,
          count,
          expiresAt: new Date(expiresAt).toISOString(),
        }),
      });
      if (!response.ok) {
        setError(`HTTP ${response.status}`);
        return;
      }
      const body = (await response.json()) as { codes: string[] };
      setCodes(body.codes);
      setBatchId("");
      setExpiresAt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="border border-rule bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
        Generate codes
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_160px_220px_auto]">
        <input
          className="rounded-sm border border-rule bg-bg px-3 py-2 text-sm"
          value={batchId}
          onChange={(event) => setBatchId(event.target.value)}
          placeholder="Batch"
        />
        <input
          className="rounded-sm border border-rule bg-bg px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
        <input
          className="rounded-sm border border-rule bg-bg px-3 py-2 text-sm"
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
        <button
          className="rounded-sm border border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
          type="button"
          onClick={() => {
            void generate();
          }}
        >
          Generate
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-error">
          {error}
        </p>
      ) : null}
      {codes.length > 0 ? (
        <div className="mt-4 border border-rule bg-bg p-3">
          <p className="text-sm font-semibold">Save these codes. They will not be shown again.</p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-sm">{codes.join("\n")}</pre>
        </div>
      ) : null}
    </section>
  );
}
