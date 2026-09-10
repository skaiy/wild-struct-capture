import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoAuthRevalidator } from "@/components/demo-auth-revalidator";

export const metadata: Metadata = {
  title: "Wild StructCapture",
  description: "用自然语言完成结构化拍录",
  applicationName: "Wild StructCapture",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "StructCapture" },
  icons: { apple: "/icons/icon-192.svg" },
};

export const viewport: Viewport = {
  themeColor: "#115e59",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <DemoAuthRevalidator />
        {children}
      </body>
    </html>
  );
}
