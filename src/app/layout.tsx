import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { WindowControls } from "@/components/desktop/window-controls";
import { AppRuntime } from "@/components/mobile/app-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "协作空间", template: "%s · 协作空间" },
  description: "一体化办公协作平台：文档、OA、CRM、ERP、WMS、TMS、PMS",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "协作空间", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#2383e2",
  width: "device-width",
  initialScale: 1,
  // 手机：内容铺到刘海 / 手势条下（由安全区变量让位），软键盘弹出时缩小布局视口，输入框不被遮挡
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // 手机 App 的 Capacitor SystemBars 会在水合前往 <html> 写入安全区 CSS 变量（style），属预期差异
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "!text-sm" }} />
        <WindowControls />
        <AppRuntime />
      </body>
    </html>
  );
}
