"use client";

import { DropdownMenu as M, Popover as P } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = "start", sideOffset = 4, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 min-w-44 rounded-md bg-white p-1 text-sm shadow-pop animate-pop-in", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({
  className,
  icon,
  danger,
  children,
  ...props
}: ComponentProps<typeof M.Item> & { icon?: ReactNode; danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex h-7 cursor-pointer select-none items-center gap-2 rounded px-2 outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40",
        danger ? "text-danger" : "text-ink",
        className,
      )}
      {...props}
    >
      {icon && <span className="flex size-4 items-center justify-center text-ink-2 [&>svg]:size-4">{icon}</span>}
      {children}
    </M.Item>
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 py-1 text-xs text-ink-3">{children}</M.Label>;
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ className, align = "start", sideOffset = 4, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 rounded-md bg-white p-2 text-sm shadow-pop animate-pop-in focus:outline-none", className)}
        {...props}
      />
    </P.Portal>
  );
}
