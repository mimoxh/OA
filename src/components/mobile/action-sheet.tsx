"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SheetAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
};

/** 手机底部操作面板（长按消息 / 会话时弹出）。基于 Radix Dialog：返回键、点遮罩、Esc 都能关闭 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  header,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  header?: ReactNode;
  actions: SheetAction[];
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <D.Content
          className="fixed inset-x-0 bottom-0 z-50 select-none rounded-t-2xl bg-white pb-[calc(var(--sab)+8px)] shadow-pop animate-pop-in [-webkit-touch-callout:none] focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // 面板在长按过程中弹出，手指仍按着时系统会把后续的长按选字落到面板上
          onContextMenu={(e) => e.preventDefault()}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong" />
          {header && <div className="border-b border-line px-4 py-3">{header}</div>}
          <div className="grid grid-cols-4 gap-y-1 px-2 py-3">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  a.onSelect();
                }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg py-2 text-xs active:bg-hover [&_svg]:size-5",
                  a.danger ? "text-danger" : "text-ink-2",
                )}
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-sidebar">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
          <D.Close className="mx-4 block h-11 w-[calc(100%-2rem)] rounded-lg bg-sidebar text-[15px] text-ink active:bg-hover">取消</D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
