"use client";

import { ArrowUpRight, Globe } from "lucide-react";
import { toast } from "sonner";
import { openMobileExternal, useIsMobileApp } from "@/lib/mobile-bridge";

/** 手机 App 内：在系统浏览器打开 Web 完整版，使用手机端尚未适配的功能 */
export function WebFullLink() {
  const app = useIsMobileApp();
  if (!app) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await openMobileExternal(`${location.origin}/work`))) toast.error("无法打开系统浏览器");
      }}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-white p-3 text-left active:bg-sidebar"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#787774]/10 text-[#787774]">
        <Globe className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">打开 Web 完整版</span>
        <span className="block truncate text-xs text-ink-3">在系统浏览器中使用全部功能（需重新登录）</span>
      </span>
      <ArrowUpRight className="size-4 text-ink-3" />
    </button>
  );
}
