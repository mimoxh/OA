"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isWindowMaximized, useIsDesktop, windowAction } from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";

function ControlButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 w-[46px] items-center justify-center text-ink-2 transition-colors",
        danger ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#b3271a]" : "hover:bg-black/[0.06] hover:text-ink active:bg-black/10",
      )}
    >
      {children}
    </button>
  );
}

/** 无边框窗口右上角的最小化 / 最大化 / 关闭按钮（仅桌面端渲染） */
export function WindowControls() {
  const desktop = useIsDesktop();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const sync = () => void isWindowMaximized().then((v) => alive && setMaximized(v));
    sync();
    window.addEventListener("resize", sync);
    return () => {
      alive = false;
      window.removeEventListener("resize", sync);
    };
  }, [desktop]);

  if (!desktop) return null;
  return (
    <div className="fixed right-0 top-0 z-[70] flex select-none">
      <ControlButton label="最小化" onClick={() => windowAction("minimize")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5.5h10" stroke="currentColor" />
        </svg>
      </ControlButton>
      <ControlButton label={maximized ? "向下还原" : "最大化"} onClick={() => windowAction("toggle_maximize")}>
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" />
            <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" stroke="currentColor" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" />
          </svg>
        )}
      </ControlButton>
      <ControlButton label="关闭" danger onClick={() => windowAction("close")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" />
        </svg>
      </ControlButton>
    </div>
  );
}

/** 没有应用顶栏的页面（登录、初始化）用来拖动窗口的顶部透明条 */
export function DesktopDragStrip() {
  const desktop = useIsDesktop();
  if (!desktop) return null;
  return <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-[60] h-10" />;
}
