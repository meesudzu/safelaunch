import { ScanForm } from "../../components/scan-form";
import viMessages from "../../messages/vi.json";
import enMessages from "../../messages/en.json";
import type { Locale } from "./layout";

const messagesFor = (locale: Locale) =>
  locale === "vi" ? viMessages : enMessages;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "vi" && locale !== "en") {
    return null;
  }
  return (
    <main>
      <ScanForm
        locale={locale}
        messages={messagesFor(locale)}
      />
    </main>
  );
}
