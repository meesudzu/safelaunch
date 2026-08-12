import { notFound } from "next/navigation";
import {
  DocumentHeading,
  DocumentSection,
  MarketingPageShell,
} from "../../../components/marketing-page-shell";
import { isLocale } from "../../../lib/locale";

export default async function PolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const vi = locale === "vi";
  return (
    <MarketingPageShell locale={locale} path="policy">
      <article className="mx-auto max-w-3xl px-5 py-12 md:py-20">
        <DocumentHeading
          version="v1.0"
          title={vi ? "Chính sách bảo mật" : "Privacy policy"}
          intro={
            vi
              ? "SafeLaunch chỉ xử lý dữ liệu cần thiết để quét website, tạo báo cáo và vận hành dịch vụ an toàn."
              : "SafeLaunch processes only the data needed to scan a website, produce a report, and operate the service safely."
          }
        />
        <DocumentSection index="01" title={vi ? "Dữ liệu được xử lý" : "Data processed"}>
          <p>
            {vi
              ? "Khi bạn bắt đầu quét, hệ thống xử lý URL đã gửi, nội dung công khai của các trang trong phạm vi, bằng chứng được trích xuất và kết quả báo cáo."
              : "When you start a scan, the system processes the submitted URL, public page content in scope, extracted evidence, and report results."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-rule bg-surface p-5">
              <h3 className="font-bold text-ink">{vi ? "Dữ liệu kỹ thuật" : "Technical data"}</h3>
              <p className="mt-2 text-sm">
                {vi
                  ? "URL, HTML công khai, metadata, liên kết và tài sản số phục vụ lượt quét."
                  : "Public URLs, HTML, metadata, links, and digital assets used by the scan."}
              </p>
            </div>
            <div className="border border-rule bg-surface p-5">
              <h3 className="font-bold text-ink">{vi ? "Không thu thập" : "Not collected"}</h3>
              <p className="mt-2 text-sm">
                {vi
                  ? "Không có tài khoản người dùng, email, mật khẩu, cookie theo dõi hoặc fingerprint thiết bị."
                  : "No user account, email, password, tracking cookie, or device fingerprint."}
              </p>
            </div>
          </div>
        </DocumentSection>
        <DocumentSection index="02" title={vi ? "Lưu trữ và xóa" : "Retention and deletion"}>
          <p>
            {vi
              ? "Dữ liệu lượt quét, bằng chứng, snapshot trang và báo cáo được giữ tối đa 7 ngày rồi được tác vụ retention xóa. Số liệu vận hành tổng hợp không chứa dữ liệu nhận dạng có thể được giữ lâu hơn."
              : "Scan records, evidence, page snapshots, and reports are retained for up to 7 days and then removed by the retention job. Aggregated non-identifying operational metrics may be retained longer."}
          </p>
        </DocumentSection>
        <DocumentSection index="03" title={vi ? "Truy cập và chia sẻ" : "Access and sharing"}>
          <p>
            {vi
              ? "Báo cáo chỉ mở bằng URL riêng tư cho đến khi hết hạn. Kho văn bản pháp lý và công cụ quản trị chỉ dành cho nhân sự được bảo vệ bởi Cloudflare Access. Chúng tôi không bán dữ liệu lượt quét."
              : "Reports are available only through their private URL until expiry. The legal corpus and admin tools are restricted through Cloudflare Access. We do not sell scan data."}
          </p>
        </DocumentSection>
        <DocumentSection index="04" title={vi ? "Liên hệ" : "Contact"}>
          <p>
            {vi
              ? "Nếu có câu hỏi về dữ liệu hoặc muốn yêu cầu hỗ trợ, hãy dùng trang Liên hệ. Đừng gửi mật khẩu, token báo cáo hoặc dữ liệu nhạy cảm qua email."
              : "For data questions or support, use the Contact page. Do not send passwords, report tokens, or sensitive data by email."}
          </p>
          <a
            href={`/${locale}/contact`}
            className="inline-flex border border-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent hover:bg-accent hover:text-[#003737]"
          >
            {vi ? "Mở trang liên hệ" : "Open contact page"}
          </a>
        </DocumentSection>
      </article>
    </MarketingPageShell>
  );
}
