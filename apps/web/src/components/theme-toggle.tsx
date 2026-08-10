"use client";

import { useEffect, useState } from "react";

export const ThemeToggle = ({ locale }: { readonly locale: "vi" | "en" }) => {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
  }, []);

  const toggle = () => {
    const next = light ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    setLight(!light);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={locale === "vi" ? "Đổi giao diện sáng hoặc tối" : "Toggle light or dark theme"}
      title={light ? (locale === "vi" ? "Chuyển sang tối" : "Use dark theme") : locale === "vi" ? "Chuyển sang sáng" : "Use light theme"}
      className="grid size-9 place-items-center border border-rule font-mono text-base text-ink-soft transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {light ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 -translate-y-px fill-current">
          <path d="M20.4 15.4A8.5 8.5 0 0 1 8.6 3.6 8.5 8.5 0 1 0 20.4 15.4Z" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
          <circle cx="12" cy="12" r="4" strokeWidth="2" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
};
