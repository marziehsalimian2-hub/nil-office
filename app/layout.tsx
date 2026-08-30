import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted Vazirmatn (variable). No external font network dependency —
// works on a fully offline internal network.
const vazir = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  variable: "--font-vazir",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "دبیرخانه نیل | NIL Office",
  description: "سامانه داخلی مکاتبات، بایگانی و حسابداری شرکت توسعه مدیریت راهبردی نیل",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12233b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
