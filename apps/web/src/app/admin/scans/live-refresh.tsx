"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(id);
  }, [enabled, router]);
  return null;
}
