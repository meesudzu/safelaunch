import { notFound } from "next/navigation";
import { MarketingPageShell } from "../../../components/marketing-page-shell";
import { isLocale } from "../../../lib/locale";

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const vi = locale === "vi";
  return (
    <MarketingPageShell locale={locale} path="contact">
      <div className="mx-auto max-w-7xl px-5 py-12 md:px-16 lg:py-20">
        <p className="w-fit border border-accent px-3 py-1 font-mono text-xs uppercase tracking-widest text-accent">
          AI assistance active
        </p>
        <h1 className="mt-8 font-serif text-5xl font-extrabold tracking-tight">
          {vi ? "Liên hệ" : "Contact"}
        </h1>
        <p className="mt-6 max-w-3xl border-l-2 border-accent pl-5 text-lg leading-8 text-ink-soft">
          {vi
            ? "Kết nối trực tiếp với nhóm vận hành SafeLaunch. Với vấn đề khẩn cấp, hãy nêu URL và loại sản phẩm nhưng không gửi mật khẩu, token hay dữ liệu nhạy cảm."
            : "Contact the SafeLaunch operations team. For urgent issues, include the URL and product type, but never send passwords, tokens, or sensitive data."}
        </p>
        <div className="mt-14 grid gap-8 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5">
            <div className="border border-rule bg-bg p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                Direct comms channel
              </p>
              <a
                href="mailto:support@safelaunch.ai"
                className="mt-3 block text-xl hover:text-accent"
              >
                support@safelaunch.ai
              </a>
            </div>
            <div className="border border-rule bg-bg p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                Operational hours
              </p>
              <p className="mt-3 text-xl">24/7 Automated Scanning</p>
              <p className="mt-1 text-sm text-ink-soft">Human response: 09:00–18:00 (GMT+7)</p>
            </div>
          </div>
          <section className="border border-rule bg-bg p-6 lg:col-span-7 lg:p-10">
            <h2 className="font-serif text-2xl font-bold">
              {vi ? "Gửi yêu cầu" : "Send a request"}
            </h2>
            <div className="mt-6 border-t border-rule pt-6">
              <p className="text-sm leading-6 text-ink-soft">
                {vi
                  ? "Email của bạn sẽ được xử lý bởi ứng dụng email trên thiết bị; SafeLaunch web không lưu nội dung biểu mẫu."
                  : "Your device email app handles the message; the SafeLaunch website does not store form content."}
              </p>
              <a
                href="mailto:support@safelaunch.ai?subject=SafeLaunch%20support%20request"
                className="mt-8 flex w-full items-center justify-between bg-accent px-6 py-4 font-bold text-[#003737] hover:bg-accent-hover"
              >
                <span>{vi ? "Mở ứng dụng email" : "Open email app"}</span>
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </MarketingPageShell>
  );
}
