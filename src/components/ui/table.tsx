import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-y border-line text-left">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line transition-colors [tbody_&]:hover:bg-sidebar", className)} {...props} />;
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-8 whitespace-nowrap px-2 text-xs font-normal text-ink-2 first:pl-0", className)} {...props} />;
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-9 px-2 py-1.5 align-middle text-ink first:pl-0", className)} {...props} />;
}

/** 表格空行 */
export function TEmpty({ colSpan, children = "暂无数据" }: { colSpan: number; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-sm text-ink-3">
        {children}
      </td>
    </tr>
  );
}
