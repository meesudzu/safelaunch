import { RedeemCodesClient } from "./redeem-codes-client";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <main>
      <RedeemCodesClient locale={locale} />
    </main>
  );
}
