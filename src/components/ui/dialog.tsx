"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  size = "md",
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-lg bg-white shadow-pop animate-pop-in focus:outline-none",
          w,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
          <div>
            <D.Title className="text-[15px] font-semibold text-ink">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] text-ink-2">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : "对话框"}</D.Description>
            )}
          </div>
          <D.Close className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="关闭">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 max-md:[&>button]:h-10 max-md:[&>button]:px-4">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}
