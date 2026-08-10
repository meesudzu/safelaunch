import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import messages from "../../messages/admin-vi.json";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = {
  title: { default: messages["shell.title"], template: `%s · ${messages["shell.title"]}` },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  const accessEmail = headers().get("cf-access-authenticated-user-email")?.trim();
  const identity = accessEmail ? accessEmail.slice(0, 320) : messages["shell.local_identity"];

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink font-sans">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a href="/admin/legal" className="font-serif text-xl font-semibold text-ink">
              {messages["shell.title"]}
            </a>
            <p className="mt-0.5 text-xs text-ink-soft">{messages["footer.disclosure"]}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <p className="text-ink-soft">
              {messages["shell.identity"]}: <span className="font-mono text-ink">{identity}</span>
            </p>
            <a
              href="/cdn-cgi/access/logout"
              className="rounded-sm border border-rule px-3 py-1.5 font-semibold text-accent hover:border-accent"
            >
              {messages["shell.logout"]}
            </a>
          </div>
        </div>
        <AdminNav />
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-rule bg-surface px-6 py-4 text-center text-xs text-ink-soft">
        {messages["footer.disclosure"]}
      </footer>
    </div>
  );
}
