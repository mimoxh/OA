"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Bell, ChevronRight, LogOut, RefreshCw, Server, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/app/login/actions";
import { resetIm } from "@/components/im/store";
import { stopRealtime } from "@/components/realtime/provider";
import {
  getMobileShellState,
  openMobileLauncher,
  openMobileNotificationSettings,
  setMobileKeepAlive,
  useIsMobileApp,
  type MobileShellState,
} from "@/lib/mobile-bridge";
import { cn } from "@/lib/utils";

function Item({ icon, label, value, onClick, children }: { icon: ReactNode; label: string; value?: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const body = (
    <>
      <span className="text-ink-2 [&>svg]:size-5">{icon}</span>
      <span className="flex-1 text-[15px] text-ink">{label}</span>
      {value != null && <span className="min-w-0 max-w-[55%] truncate text-right text-[13px] text-ink-3">{value}</span>}
      {children}
      {onClick && <ChevronRight className="size-4 shrink-0 text-ink-3" />}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-hover">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/** 服务器、通知与版本信息。App 内读取原生壳层状态；浏览器里只显示当前地址 */
export function MeAppSection() {
  const inApp = useIsMobileApp();
  const [state, setState] = useState<MobileShellState | null>(null);
  const [origin, setOrigin] = useState("");
  const [insecure, setInsecure] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    // localhost 走 HTTP 也算安全上下文（调试时 adb reverse），只在真正的非安全连接下提示
    setInsecure(!window.isSecureContext);
    if (!inApp) return;
    const load = () => void getMobileShellState().then(setState);
    load();
    // 从系统通知设置页返回后刷新开关状态
    const onVis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [inApp]);

  const toggleKeepAlive = async (on: boolean) => {
    setState((s) => (s ? { ...s, keepAlive: on } : s));
    await setMobileKeepAlive(on);
    toast.success(on ? "已开启后台接收消息" : "已关闭后台接收消息");
  };

  const server = state?.activeServerUrl ?? origin;
  return (
    <>
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-white">
        <Item icon={<Server />} label="服务器" value={server.replace(/^https?:\/\//, "")} />
        {insecure && (
          <div className="bg-tag-yellow/50 px-4 py-2 text-xs text-tag-yellow-ink">
            当前是 HTTP 连接：消息收发正常，但音视频通话不可用、流量未加密。正式使用请让管理员配置 HTTPS。
          </div>
        )}
        {inApp && <Item icon={<RefreshCw />} label="切换服务器" onClick={() => openMobileLauncher()} />}
      </div>

      {inApp && (
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-white">
          <Item
            icon={<Bell />}
            label="通知设置"
            value={state ? (state.notificationsEnabled ? "已开启" : "已关闭") : undefined}
            onClick={() => openMobileNotificationSettings()}
          />
          <Item icon={<Smartphone />} label="后台接收消息">
            <Switch checked={!!state?.keepAlive} disabled={!state} onChange={(v) => void toggleKeepAlive(v)} />
          </Item>
          {state && (
            <Item
              icon={<span className="block size-5" />}
              label="版本"
              value={`${state.appVersion}${state.debug ? "（调试版）" : ""} · Android ${state.release}`}
            />
          )}
        </div>
      )}
    </>
  );
}

export function MeLogout() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          void import("@/components/call/store").then((m) => m.resetCallStore());
          stopRealtime();
          resetIm();
          await logout();
        })
      }
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-[15px] text-danger active:bg-hover disabled:opacity-50"
    >
      <LogOut className="size-5" />
      退出登录
    </button>
  );
}
