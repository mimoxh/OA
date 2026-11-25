"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AtSign, Bell, BellRing, ChevronRight, ClipboardCheck, MessageCircle, ShieldCheck, Smartphone, Users } from "lucide-react";
import { toast } from "sonner";
import { getDesktopNotifyState, subscribeDesktopNotify, toggleDesktopNotify } from "@/lib/im/desktop-notify";
import {
  getMobilePushState,
  openMobileChannelSettings,
  requestMobileNotificationPermission,
  setMobileKeepAlive,
  setMobileNotifyEnabled,
  useIsMobileApp,
  type MobilePushChannelKey,
  type MobilePushState,
} from "@/lib/mobile-bridge";
import { cn } from "@/lib/utils";
import { Item, Switch } from "../me-client";

const CHANNELS: { key: MobilePushChannelKey; icon: ReactNode; label: string; desc: string }[] = [
  { key: "dm", icon: <MessageCircle />, label: "单聊消息", desc: "同事发给你的消息，标题为对方姓名" },
  { key: "group", icon: <Users />, label: "群聊消息", desc: "群里的新消息，显示为“发送人：内容”；免打扰的群不提醒" },
  { key: "mention", icon: <AtSign />, label: "@我", desc: "群里有人 @你 或 @所有人，免打扰的群也会提醒" },
  { key: "system", icon: <ClipboardCheck />, label: "审批与系统通知", desc: "审批助手、项目助手等发来的待办和结果卡片" },
];

export function serviceLabel(state: MobilePushState | null): { text: string; tone: "ok" | "warn" | "off" } {
  if (!state) return { text: "读取中…", tone: "off" };
  if (!state.notifyEnabled) return { text: "已关闭消息通知", tone: "off" };
  if (!state.keepAlive) return { text: "未开启后台接收", tone: "warn" };
  switch (state.service.state) {
    case "connected":
      return { text: "已连接，后台可接收", tone: "ok" };
    case "connecting":
      return { text: "正在连接…", tone: "warn" };
    case "unauthorized":
      return { text: "未登录或登录已过期", tone: "warn" };
    case "stopped":
    case undefined:
      return { text: "后台服务未运行", tone: "warn" };
    default:
      return { text: "连接中断，自动重连中", tone: "warn" };
  }
}

export function useMobilePushState(inApp: boolean) {
  const [state, setState] = useState<MobilePushState | null>(null);
  const reload = useCallback(() => {
    void getMobilePushState().then((s) => s && setState(s));
  }, []);
  useEffect(() => {
    if (!inApp) return;
    reload();
    // 从系统设置页返回、后台服务状态变化后刷新
    const onVis = () => !document.hidden && reload();
    document.addEventListener("visibilitychange", onVis);
    const timer = setInterval(() => !document.hidden && reload(), 3000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(timer);
    };
  }, [inApp, reload]);
  return { state, setState, reload };
}

export function Tone({ tone, children }: { tone: "ok" | "warn" | "off"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px]",
        tone === "ok" ? "text-[#448361]" : tone === "warn" ? "text-[#d9730d]" : "text-ink-3",
      )}
    >
      <span className={cn("size-2 rounded-full", tone === "ok" ? "bg-[#448361]" : tone === "warn" ? "bg-[#d9730d]" : "bg-ink-3")} />
      {children}
    </span>
  );
}

function BrowserNotifySettings() {
  const status = useSyncExternalStore(subscribeDesktopNotify, getDesktopNotifyState, () => "unsupported" as const);
  return (
    <>
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-white">
        <Item icon={<Bell />} label="浏览器通知" value={status === "unsupported" ? "当前浏览器不支持" : status === "denied" ? "已被浏览器禁止" : undefined}>
          {status !== "unsupported" && status !== "denied" && (
            <Switch checked={status === "on"} onChange={() => void toggleDesktopNotify()} />
          )}
        </Item>
      </div>
      <p className="mt-2 px-1 text-xs leading-5 text-ink-3">
        浏览器只在页面打开时提醒。需要锁屏和后台也能收到消息，请安装 OA 手机 App，并在 App 的“我的 → 通知”里开启后台接收。
      </p>
    </>
  );
}

export function NotificationSettings() {
  const inApp = useIsMobileApp();
  const { state, setState, reload } = useMobilePushState(inApp);
  if (!inApp) return <BrowserNotifySettings />;

  const toggleNotify = async (on: boolean) => {
    setState((s) => (s ? { ...s, notifyEnabled: on } : s));
    await setMobileNotifyEnabled(on);
    if (on && state && !state.permissionGranted) await requestMobileNotificationPermission();
    toast.success(on ? "已开启消息通知" : "已关闭消息通知");
    reload();
  };
  const toggleKeepAlive = async (on: boolean) => {
    setState((s) => (s ? { ...s, keepAlive: on } : s));
    await setMobileKeepAlive(on);
    reload();
  };
  const svc = serviceLabel(state);
  const systemBlocked = !!state && state.notifyEnabled && (!state.permissionGranted || !state.notificationsEnabled);

  return (
    <>
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-white">
        <Item icon={<BellRing />} label="接收消息通知">
          <Switch checked={!!state?.notifyEnabled} disabled={!state} onChange={(v) => void toggleNotify(v)} />
        </Item>
        {systemBlocked && (
          <button
            type="button"
            onClick={() => void requestMobileNotificationPermission().then(reload)}
            className="block w-full bg-tag-orange/40 px-4 py-2 text-left text-xs text-tag-orange-ink"
          >
            系统已禁止 OA 发送通知，点这里开启通知权限。
          </button>
        )}
      </div>

      <div className="mt-4 px-1 text-xs text-ink-3">通知类别（点开可在系统里单独设置声音、横幅或关闭）</div>
      <div className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl bg-white">
        {CHANNELS.map((c) => {
          const ch = state?.channels.find((x) => x.key === c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => void openMobileChannelSettings(c.key)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-hover"
            >
              <span className="mt-0.5 text-ink-2 [&>svg]:size-5">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-ink">{c.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-ink-3">{c.desc}</span>
              </span>
              <span className={cn("mt-0.5 shrink-0 text-[13px]", ch && !ch.enabled ? "text-danger" : "text-ink-3")}>
                {ch ? (ch.enabled ? "已开启" : "已关闭") : ""}
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3" />
            </button>
          );
        })}
      </div>

      <div className="mt-4 px-1 text-xs text-ink-3">后台保活</div>
      <div className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl bg-white">
        <Item icon={<Smartphone />} label="后台接收消息">
          <Switch checked={!!state?.keepAlive} disabled={!state || !state.notifyEnabled} onChange={(v) => void toggleKeepAlive(v)} />
        </Item>
        <Item icon={<span className="block size-5" />} label="连接状态">
          <Tone tone={svc.tone}>{svc.text}</Tone>
        </Item>
        {state?.service.lastError && svc.tone !== "ok" && (
          <div className="px-4 py-2 text-xs text-ink-3">最近错误：{state.service.lastError}</div>
        )}
        <Item
          icon={<span className="block size-5" />}
          label="忽略电池优化"
          value={state ? (state.ignoringBatteryOptimizations ? "已允许" : "未允许") : undefined}
        />
        <Link href="/me/notifications/guide" className="flex items-center gap-3 px-4 py-3 active:bg-hover">
          <span className="text-ink-2 [&>svg]:size-5">
            <ShieldCheck />
          </span>
          <span className="flex-1 text-[15px] text-ink">后台保活设置引导</span>
          <span className="text-[13px] text-ink-3">{state?.manufacturer ?? ""}</span>
          <ChevronRight className="size-4 shrink-0 text-ink-3" />
        </Link>
      </div>
      <p className="mt-2 px-1 text-xs leading-5 text-ink-3">
        后台接收会在通知栏常驻一个“后台连接”图标，用来在锁屏和 App 退到后台时接收提醒。部分手机会自动清理后台，请按引导开启自启动并允许后台运行。
      </p>

      <div className="mt-4 px-1 text-xs text-ink-3">提醒规则</div>
      <ul className="mt-1.5 list-disc space-y-1 rounded-xl bg-white py-3 pl-8 pr-4 text-xs leading-5 text-ink-2">
        <li>自己发的消息不提醒；免打扰的会话只在 @我 时提醒。</li>
        <li>App 打开并停在某个会话时，该会话的新消息不提醒。</li>
        <li>电脑上正在使用 OA（页面在前台且最近 2 分钟内有操作）时，手机不再响铃。</li>
        <li>在任一设备上看过或回复了会话，手机上该会话的通知会自动清除。</li>
      </ul>
    </>
  );
}
