import { ScanFormContainer } from "../../components/scan-form-container";
import type { ScanFormMessages } from "../../components/scan-form";
import viMessages from "../../messages/vi.json";
import enMessages from "../../messages/en.json";
import type { Locale } from "./layout";
import { createScan } from "./actions";

const messagesFor = (locale: Locale) => (locale === "vi" ? viMessages : enMessages);

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "vi" && locale !== "en") {
    return null;
  }
  // `createScan` is a Server Action ("use server") — it serialises across the
  // server → client boundary safely, and the API call (including the
  // NEXT_PUBLIC_API_ORIGIN lookup) stays on the server. This avoids relying
  // on `NEXT_PUBLIC_*` being inlined into the browser bundle at build time.
  return (
    <main>
      <ScanFormContainer
        locale={locale}
        // Cast: ScanFormMessages is narrower than the full vi.json bundle.
        messages={messagesFor(locale) as unknown as ScanFormMessages}
        createScan={createScan}
      />
    </main>
  );
}
