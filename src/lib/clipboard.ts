"use client";

import { toast } from "sonner";
import { copyTextNative, isMobileApp } from "./mobile-bridge";

function execCommandCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const prevFocus = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  prevFocus?.focus?.({ preventScroll: true });
  return ok;
}

/**
 * 复制文本：navigator.clipboard 只在安全上下文（HTTPS / localhost）可用，
 * 局域网 HTTP 下依次退回手机 App 原生剪贴板、document.execCommand("copy")。
 */
export async function copyText(text: string): Promise<boolean> {
  if (isMobileApp() && (await copyTextNative(text))) return true;
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  return execCommandCopy(text);
}

/** 复制并提示结果；失败时说明原因（通常是 HTTP 访问且浏览器禁止了降级复制） */
export async function copyWithToast(text: string, success = "已复制"): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) toast.success(success);
  else
    toast.error(
      typeof window !== "undefined" && !window.isSecureContext
        ? "当前通过 HTTP 访问，浏览器不允许写入剪贴板，请手动选择文字复制"
        : "复制失败，请手动选择文字复制",
    );
  return ok;
}
