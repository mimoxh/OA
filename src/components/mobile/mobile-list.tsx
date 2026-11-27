import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 手机端列表（< md）：桌面表格在手机上换成一张张卡片，桌面端不渲染。
 * 和桌面表格并列放置，表格加 className="max-md:hidden"。
 */
export function MobileList({ children, className, empty }: { children: ReactNode; className?: string; empty?: ReactNode }) {
  const has = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <ul className={cn("space-y-2 md:hidden", className)} data-mobile-list>
      {has ? children : empty != null && <li className="rounded-lg border border-dashed border-line-strong py-10 text-center text-sm text-ink-3">{empty}</li>}
    </ul>
  );
}

/**
 * 列表卡片：第一行标题 + 状态标签，第二行副标题（编号、客户等），第三行关键字段（负责人、日期）+ 右侧金额 / 数量。
 * 标题允许换行，其余各行单行省略，不会把卡片撑出屏幕。
 */
export function MobileCard({
  href,
  icon,
  title,
  badge,
  subtitle,
  meta,
  aside,
  children,
  className,
}: {
  href?: string;
  icon?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start gap-2">
        {icon != null && <span className="mt-0.5 shrink-0 text-base leading-none">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] font-medium leading-snug text-ink">{title}</span>
          {subtitle != null && <span className="mt-0.5 block truncate text-xs text-ink-3">{subtitle}</span>}
        </span>
        {badge != null && <span className="flex shrink-0 items-center gap-1">{badge}</span>}
      </div>
      {(meta != null || aside != null) && (
        <div className="mt-2 flex items-center gap-3 text-[13px] text-ink-2">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:truncate">{meta}</span>
          {aside != null && <span className="shrink-0 text-right font-medium tabular-nums text-ink">{aside}</span>}
        </div>
      )}
      {children}
    </>
  );
  const cls = cn("block rounded-lg border border-line bg-white px-3.5 py-3", href && "active:bg-hover", className);
  return <li>{href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

/** 卡片里的「标签：值」小字段 */
export function MobileField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="text-ink-3">{label} </span>
      {children}
    </span>
  );
}
