import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeLaunch",
  description:
    "An evidence-led compliance signal for Vietnam. Launch globally, compliant from day one.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <body className="bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
