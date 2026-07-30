import { ScanProgress, type ScanProgressMessages } from "../../../../components/scan-progress";
import progressVi from "../../../../messages/progress-vi.json";
import progressEn from "../../../../messages/progress-en.json";
import { createApiClient } from "../../../../lib/api-client";
import type { Locale } from "../../../../lib/locale";

const messagesFor = (locale: Locale): ScanProgressMessages =>
  locale === "vi" ? progressVi : progressEn;

export default async function ScanPage({
  params,
}: {
  params: Promise<{ locale: string; scanId: string }>;
}) {
  const { locale, scanId } = await params;
  if (locale !== "vi" && locale !== "en") {
    return null;
  }
  const client = createApiClient({
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  });
  let initial;
  try {
    initial = await client.getScan(scanId);
  } catch {
    initial = {
      scanId,
      state: "queued",
      coverage: { fetched: [], failed: [], skipped: [] },
    };
  }

  return (
    <main>
      <ScanProgress
        locale={locale}
        messages={messagesFor(locale)}
        initialState={initial}
        poll={async (id) => client.getScan(id)}
      />
    </main>
  );
}
