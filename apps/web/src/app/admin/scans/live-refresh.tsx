"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls `router.refresh()` every 5s while `enabled` is true AND the tab is
 * visible. Hidden tabs pause polling so background admin pages do not hammer
 * the worker; the timer resumes when the tab becomes visible again.
 *
 * Polling is intentionally fixed-rate (no backoff) because the list page
 * is opt-in: it only mounts `<LiveRefresh enabled />` when the user
 * ticks `live=true`, and admins expect a snappy view of in-flight scans.
 */
export function LiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let timer: number | null = null;
    const tick = (): void => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const start = (): void => {
      if (timer !== null) return;
      timer = window.setInterval(tick, 5_000);
    };
    const stop = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [enabled, router]);
  return null;
}
