"use client";

import { useRouter } from "next/navigation";
import { ScanForm, type ScanFormMessages } from "./scan-form";

export interface ScanFormContainerProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanFormMessages;
}

/**
 * Thin routing-aware wrapper around `ScanForm`. Kept separate so `ScanForm`
 * itself stays free of `next/navigation`'s `useRouter` (which requires an
 * `AppRouterContext` provider) and remains easy to unit test.
 */
export const ScanFormContainer = ({ locale, messages }: ScanFormContainerProps) => {
  const router = useRouter();
  return (
    <ScanForm
      locale={locale}
      messages={messages}
      onScanCreated={(scanId) => router.push(`/${locale}/scan/${scanId}`)}
    />
  );
};
