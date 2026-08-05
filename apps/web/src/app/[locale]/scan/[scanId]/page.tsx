import { ScanProgress, type ScanProgressMessages } from "../../../../components/scan-progress";
import progressVi from "../../../../messages/progress-vi.json";
import progressEn from "../../../../messages/progress-en.json";
import type { Locale } from "../../../../lib/locale";
import { getScan } from "../../actions";

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
  let initial;
  try {
    initial = await getScan(scanId);
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
        poll={getScan}
      />
    </main>
  );
}
