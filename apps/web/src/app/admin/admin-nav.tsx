"use client";

import { usePathname } from "next/navigation";
import messages from "../../messages/admin-vi.json";

const links = [
  { href: "/admin/legal", label: messages["shell.legal"] },
  { href: "/admin/audit", label: messages["shell.audit"] },
] as const;

const future = [messages["shell.metrics"], messages["shell.logs"]] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Điều hướng quản trị" className="border-t border-rule px-6">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto py-2">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <a
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-sm px-3 py-2 text-sm font-semibold ${
                active ? "bg-accent text-white" : "text-ink-soft hover:bg-bg hover:text-ink"
              }`}
            >
              {link.label}
            </a>
          );
        })}
        {future.map((label) => (
          <span
            key={label}
            aria-disabled="true"
            title={messages["shell.coming_soon"]}
            className="whitespace-nowrap px-3 py-2 text-sm text-ink-soft opacity-50"
          >
            {label}
          </span>
        ))}
      </div>
    </nav>
  );
}
