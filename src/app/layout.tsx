import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "协作空间", template: "%s · 协作空间" },
  description: "一体化办公协作平台：文档、OA、CRM、ERP、WMS、TMS、PMS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "!text-sm" }} />
      </body>
    </html>
  );
}
