import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import messages from "../../messages/admin-vi.json";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = {
  title: "SafeLaunch Admin",
};

const navItems = [
  { href: "/admin/legal", label: messages["nav.legal"] },
  { href: "/admin/audit", label: messages["nav.audit"] },
  { href: "/admin/metrics", label: messages["nav.metrics"] },
  { href: "/admin/logs", label: messages["nav.logs"], disabled: true },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const adminEmail =
    headers().get("cf-access-authenticated-user-email") ?? messages["admin.local_actor"];

  return (
    <main className="min-h-screen bg-bg text-ink font-sans">
      <header className="border-b border-rule px-6 py-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-serif text-2xl font-semibold">{messages["admin.title"]}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
              {messages["admin.reviewer"]}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-soft">{adminEmail}</p>
          </div>
          <a
            href="/cdn-cgi/access/logout"
            className="inline-flex w-fit rounded-sm border border-rule px-3 py-2 text-xs font-semibold uppercase tracking-wider text-accent hover:border-accent"
          >
            {messages["admin.logout"]}
          </a>
        </div>
        <AdminNav label={messages["nav.label"]} items={navItems} />
      </header>
      {children}
      <footer className="border-t border-rule px-6 py-4 text-xs text-ink-soft">
        <div className="mx-auto max-w-6xl">{messages["footer.disclosure"]}</div>
      </footer>
    </main>
  );
}
