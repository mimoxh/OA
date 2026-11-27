"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { MoreHorizontal } from "lucide-react";

/**
 * 手机顶栏的「更多」：把放不下的操作收进底部面板，面板里直接复用桌面端的操作组件（按钮 / 弹窗触发器）。
 * 点了按钮后如果没有弹出新的对话框（如固定、进入群聊）就收起面板；弹出了对话框则保留面板，否则对话框会随面板一起卸载。
 */
export function MobileMore({ children, label = "更多操作" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);

  const onClickCapture = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest("button, a")) return;
    const before = document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length;
    setTimeout(() => {
      const after = document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length;
      if (after <= before) setOpen(false);
    }, 80);
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <button type="button" aria-label={label} className="rounded-md p-1.5 text-ink-2 active:bg-hover md:hidden">
          <MoreHorizontal className="size-5" />
        </button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in md:hidden" />
        <D.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onClickCapture={onClickCapture}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-white px-3 pb-[calc(var(--sab)+12px)] pt-2 shadow-pop animate-pop-in focus:outline-none md:hidden"
        >
          <D.Title className="sr-only">{label}</D.Title>
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" />
          {/* 复用的操作组件按整行显示 */}
          <div className="flex flex-col gap-1 [&>*]:w-full [&_button]:h-11 [&_button]:w-full [&_button]:justify-start [&_button]:gap-2.5 [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:text-[15px] [&_button]:shadow-none [&_button:active]:bg-hover [&_button_svg]:size-[18px] [&_a]:flex [&_a]:h-11 [&_a]:w-full [&_a]:items-center [&_a]:justify-start [&_a]:gap-2.5 [&_a]:border-0 [&_a]:bg-transparent [&_a]:px-3 [&_a]:text-[15px] [&_a]:shadow-none [&_a:active]:bg-hover [&_a_svg]:size-[18px]">
            {children}
          </div>
          <D.Close className="mt-2 block h-11 w-full rounded-lg bg-sidebar text-[15px] text-ink active:bg-hover">取消</D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
