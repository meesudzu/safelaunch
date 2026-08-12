import { notFound } from "next/navigation";
import {
  DocumentHeading,
  DocumentSection,
  MarketingPageShell,
} from "../../../components/marketing-page-shell";
import { isLocale } from "../../../lib/locale";

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const vi = locale === "vi";
  const sections: readonly [string, string, string] = vi
    ? ["Phạm vi dịch vụ", "Phân tích tuân thủ", "Trách nhiệm sử dụng"]
    : ["Service scope", "Compliance analysis", "Acceptable use"];
  return (
    <MarketingPageShell locale={locale} path="term">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-12 md:px-16 lg:grid-cols-12 lg:py-20">
        <aside className="hidden lg:col-span-3 lg:block">
          <nav className="sticky top-28 border-l border-rule pl-6">
            <p className="mb-5 font-mono text-xs uppercase tracking-widest text-accent">Index</p>
            {sections.map((title, i) => (
              <a
                key={title}
                href={`#section-0${i + 1}`}
                className="mb-4 flex gap-4 text-sm text-ink-soft hover:text-accent"
              >
                <span className="font-mono text-xs">0{i + 1}</span>
                {title}
              </a>
            ))}
          </nav>
        </aside>
        <article className="lg:col-span-9 lg:max-w-3xl">
          <DocumentHeading
            version="v1.0"
            title={vi ? "Điều khoản dịch vụ" : "Terms of service"}
            intro={
              vi
                ? "Các điều khoản cốt lõi áp dụng khi bạn sử dụng công cụ quét và báo cáo tín hiệu tuân thủ của SafeLaunch AI."
                : "The core terms that apply when you use SafeLaunch AI scans and compliance-signal reports."
            }
          />
          <DocumentSection index="01" title={sections[0]}>
            <p>
              {vi
                ? "SafeLaunch AI phân tích nội dung công khai của URL bạn cung cấp và tạo báo cáo tín hiệu tuân thủ. Dịch vụ không thay thế tư vấn pháp lý chuyên nghiệp."
                : "SafeLaunch AI analyses public content at the URL you submit and produces a compliance-signal report. The service does not replace professional legal advice."}
            </p>
          </DocumentSection>
          <DocumentSection index="02" title={sections[1]}>
            <p>
              {vi
                ? "Kết quả phụ thuộc vào nội dung công khai tại thời điểm quét, phạm vi trang truy cập được và phiên bản quy tắc ghi trong báo cáo. Báo cáo có thể không đầy đủ nếu một số trang bị chặn hoặc không tồn tại."
                : "Results depend on public content available at scan time, reachable pages, and the ruleset version shown in the report. Reports may be incomplete when pages are blocked or missing."}
            </p>
          </DocumentSection>
          <DocumentSection index="03" title={sections[2]}>
            <div className="border border-rule bg-surface p-6">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-accent">
                {vi ? "Giới hạn sử dụng" : "Usage limits"}
              </p>
              <p className="mt-4">
                {vi
                  ? "Bạn chỉ gửi URL mà mình có quyền kiểm tra, không tìm cách vượt kiểm soát truy cập và tự chịu trách nhiệm cho quyết định dựa trên báo cáo. SafeLaunch cung cấp công cụ chẩn đoán; việc khắc phục và xác nhận pháp lý cuối cùng thuộc về người vận hành."
                  : "Submit only URLs you are authorised to assess, do not attempt to bypass access controls, and remain responsible for decisions based on a report. SafeLaunch is a diagnostic tool; remediation and final legal review remain with the operator."}
              </p>
            </div>
          </DocumentSection>
        </article>
      </div>
    </MarketingPageShell>
  );
}
