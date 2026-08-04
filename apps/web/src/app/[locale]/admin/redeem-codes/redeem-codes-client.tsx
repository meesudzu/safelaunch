"use client";

import { useMemo, useState } from "react";

export interface RedeemCodeRow {
  id: string;
  codeHashPrefix: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface RedeemCodesClientProps {
  readonly locale: string;
}

export const RedeemCodesClient = (props: RedeemCodesClientProps) => {
  void props.locale;
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [latestPlaintext, setLatestPlaintext] = useState<string | null>(null);
  const [latestPrefix, setLatestPrefix] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiOrigin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return "";
  }, []);

  const create = async () => {
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/redeem-codes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          expiresAt: new Date(expiresAt).toISOString(),
        }),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { code: string; codeHashPrefix: string };
      setLatestPlaintext(body.code);
      setLatestPrefix(body.codeHashPrefix);
      setLabel("");
      setExpiresAt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <h1 className="font-serif text-2xl font-semibold">Redeem codes</h1>

      <section className="rounded-sm border border-rule p-4">
        <h2 className="text-sm font-semibold">Create a code</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">Label</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              data-testid="redeem-label"
              className="rounded-sm border border-rule bg-bg px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">Expires at</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              data-testid="redeem-expiry"
              className="rounded-sm border border-rule bg-bg px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              void create();
            }}
            data-testid="create-btn"
            className="inline-flex w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-surface"
          >
            Create
          </button>
          {error ? (
            <p role="alert" className="text-xs text-error">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {latestPlaintext ? (
        <section
          role="alert"
          data-testid="latest-code"
          className="rounded-sm border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold">Save this code — it will not be shown again.</p>
          <code
            data-testid="latest-code-value"
            className="mt-2 block rounded-sm bg-bg p-2 font-mono text-base"
          >
            {latestPlaintext}
          </code>
          <p className="mt-2 text-xs text-ink-soft">
            Hash prefix: <code>{latestPrefix}</code>
          </p>
        </section>
      ) : null}
    </div>
  );
};
