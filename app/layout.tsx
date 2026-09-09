import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wild StructCapture",
  description: "多轮自然语言拍照与结构化复核",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "StructCapture" },
};

export const viewport: Viewport = {
  themeColor: "#141c18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
