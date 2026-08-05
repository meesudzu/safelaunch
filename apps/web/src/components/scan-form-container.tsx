"use client";

import { ScanForm, type ScanFormMessages, type ScanFormProps } from "./scan-form";

export interface ScanFormContainerProps {
  readonly locale: "vi" | "en";
  readonly messages: ScanFormMessages;
  readonly createScan?: ScanFormProps["createScan"];
}

/** Thin wrapper around `ScanForm` so the server component tree has a single,
 * stable entry point regardless of what `ScanForm` needs internally. */
export const ScanFormContainer = ({ locale, messages, createScan }: ScanFormContainerProps) => {
  return (
    <ScanForm
      locale={locale}
      messages={messages}
      {...(createScan ? { createScan } : {})}
    />
  );
};
