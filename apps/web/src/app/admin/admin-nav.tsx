"use client";

import { usePathname } from "next/navigation";

interface AdminNavItem {
  href: string;
  label: string;
  disabled?: boolean;
}

export function AdminNav({ label, items }: { label: string; items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="mx-auto mt-4 flex max-w-6xl flex-wrap gap-2">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-disabled={item.disabled ? "true" : undefined}
            className={[
              "rounded-sm border px-3 py-2 text-xs font-semibold uppercase tracking-wider",
              active
                ? "border-accent bg-accent/10 text-accent"
                : "border-rule bg-surface text-ink-soft hover:border-accent hover:text-accent",
              item.disabled ? "opacity-50" : "",
            ].join(" ")}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
