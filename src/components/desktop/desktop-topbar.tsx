"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Copy, FolderOpen, Monitor, RotateCw, Search, Server, Settings2, Wifi, WifiOff } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { openCommandPalette } from "@/components/shell/command-palette";
import { useRealtimeStatus } from "@/components/realtime/provider";
import { getDesktopContext, openDataDir, openLauncher, type DesktopContext } from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";

type NavigationLike = EventTarget & { canGoBack: boolean; canGoForward: boolean };

function getNavigation(): NavigationLike | null {
  return (window as unknown as { navigation?: NavigationLike }).navigation ?? null;
}

function subscribeHistory(cb: () => void) {
  const nav = getNavigation();
  nav?.addEventListener("currententrychange", cb);
  return () => nav?.removeEventListener("currententrychange", cb);
}

/** 用 Navigation API 判断能否前进 / 后退（WebView2 基于 Chromium，均支持） */
function useHistoryAvailability() {
  const snapshot = useSyncExternalStore(
    subscribeHistory,
    () => {
      const nav = getNavigation();
      return nav ? `${nav.canGoBack ? 1 : 0}${nav.canGoForward ? 1 : 0}` : "11";
    },
    () => "00",
  );
  return { back: snapshot[0] === "1", forward: snapshot[1] === "1" };
}

function BarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-active hover:text-ink disabled:pointer-events-none disabled:opacity-35 [&>svg]:size-4"
    >
      {children}
    </button>
  );
}

function hostOf(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function WorkspaceStatus() {
  const [ctx, setCtx] = useState<DesktopContext | null>(null);
  const rt = useRealtimeStatus();

  useEffect(() => {
    let alive = true;
    const load = () => void getDesktopContext().then((c) => alive && setCtx(c));
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!ctx) return null;
  const isServer = ctx.mode === "server";
  const server = ctx.server;
  const connected = rt === "open";
  const label = isServer ? (server?.lan ? "本机服务器 · 局域网" : "本机服务器") : hostOf(ctx.serverUrl);
  const dot = isServer && server?.status === "error" ? "bg-danger" : connected ? "bg-emerald-500" : "bg-amber-400";

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已复制访问地址");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md px-2 text-xs text-ink-2 transition-colors hover:bg-active hover:text-ink data-[state=open]:bg-active"
        >
          <span className={cn("size-2 shrink-0 rounded-full", dot)} />
          {isServer ? <Server className="size-3.5 shrink-0" /> : <Monitor className="size-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="w-72">
        <MenuLabel>{isServer ? "本机托管的工作空间" : `已连接 ${hostOf(ctx.serverUrl)}`}</MenuLabel>
        <div className="flex items-center gap-2 px-2 pb-1.5 text-xs text-ink-2">
          {connected ? <Wifi className="size-3.5 text-emerald-600" /> : <WifiOff className="size-3.5 text-amber-500" />}
          {connected ? "实时连接正常" : "实时连接中断，正在重连…"}
        </div>
        {isServer && server && (
          <>
            <MenuSeparator />
            {server.lan && server.addresses.length > 0 ? (
              <>
                <MenuLabel>同事可通过以下地址访问</MenuLabel>
                {server.addresses.map((a) => (
                  <MenuItem key={a.url} icon={<Copy />} onSelect={() => void copy(a.url)}>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{a.url}</span>
                    <span className="max-w-20 shrink-0 truncate text-[11px] text-ink-3">{a.name}</span>
                  </MenuItem>
                ))}
              </>
            ) : (
              <MenuItem disabled icon={<WifiOff />}>
                未开启局域网访问
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<Settings2 />} onSelect={() => openLauncher("settings")}>
              服务器设置…
            </MenuItem>
            <MenuItem icon={<FolderOpen />} onSelect={() => openDataDir()}>
              打开数据目录
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem icon={<Monitor />} onSelect={() => openLauncher("home")}>
          切换工作空间…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/**
 * 桌面端一体式顶栏：位于左侧导航栏右边，空白处可拖动窗口；
 * 右侧留出窗口按钮（WindowControls，138px）的位置。
 */
export function DesktopTopBar() {
  const router = useRouter();
  const history = useHistoryAvailability();
  return (
    <header
      data-tauri-drag-region
      className="fixed left-16 right-0 top-0 z-30 flex h-10 select-none items-center gap-0.5 border-b border-line bg-sidebar pl-2 pr-[146px]"
    >
      <BarButton label="后退" disabled={!history.back} onClick={() => window.history.back()}>
        <ArrowLeft />
      </BarButton>
      <BarButton label="前进" disabled={!history.forward} onClick={() => window.history.forward()}>
        <ArrowRight />
      </BarButton>
      <BarButton label="刷新" onClick={() => router.refresh()}>
        <RotateCw />
      </BarButton>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 justify-center px-4">
        <button
          type="button"
          onClick={() => openCommandPalette()}
          className="flex h-7 w-full max-w-[460px] items-center gap-2 rounded-md border border-line bg-white px-2.5 text-[13px] text-ink-3 shadow-card transition-colors hover:border-line-strong hover:text-ink-2"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">搜索消息、文档、联系人、应用</span>
          <kbd className="shrink-0 rounded border border-line bg-sidebar px-1 font-sans text-[11px] leading-4">Ctrl K</kbd>
        </button>
      </div>
      <WorkspaceStatus />
    </header>
  );
}
