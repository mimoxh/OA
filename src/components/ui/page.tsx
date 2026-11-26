import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileBack } from "@/components/mobile/mobile-back";

export type Crumb = { label: ReactNode; href?: string };

/** 页面顶部细条：面包屑 + 右侧操作（类似 Notion 顶栏） */
export function TopBar({ crumbs, actions }: { crumbs: Crumb[]; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex h-11 items-center justify-between gap-3 bg-white/90 px-3 backdrop-blur">
      <nav className="flex min-w-0 items-center gap-0.5 text-sm text-ink-2">
        <MobileBack />
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-3" />}
            {c.href ? (
              <Link href={c.href} className="truncate rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className="truncate px-1.5 py-0.5 text-ink">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** 页面主体容器 */
export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn("mx-auto w-full px-6 pb-24 sm:px-12 max-md:px-4", wide ? "max-w-[1400px]" : "max-w-[1100px]", className)}>{children}</div>;
}

/** 大标题区（Notion 页面标题） */
export function PageHeader({
  icon,
  title,
  description,
  actions,
  meta,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="pt-10 pb-6 max-md:pt-4 max-md:pb-4">
      {icon && <div className="mb-3 text-[44px] leading-none max-md:mb-2 max-md:text-[32px]">{icon}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink max-md:text-[22px] max-md:break-words">{title}</h1>
          {description && <p className="mt-1.5 text-[15px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm max-md:mt-3 max-md:gap-x-4">{meta}</div>}
    </header>
  );
}

export function Section({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8", className)}>
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-line bg-white", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
}) {
  const body = (
    <div className="flex h-full flex-col rounded-lg border border-line bg-white p-4 transition-colors hover:bg-sidebar">
      <div className="flex items-center justify-between text-[13px] text-ink-2">
        <span>{label}</span>
        {icon && <span className="text-ink-3 [&>svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** 属性列表（Notion 页面属性） */
export function Properties({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-y-0.5 py-2 text-sm">{children}</div>;
}

export function Property({ label, icon, children }: { label: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[160px_1fr] items-center gap-2 max-md:grid-cols-[88px_1fr] max-md:items-start max-md:py-1">
      <div className="flex items-center gap-1.5 text-ink-2 [&>svg]:size-4 [&>svg]:text-ink-3">
        {icon}
        {label}
      </div>
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
      {icon && <div className="mb-3 text-3xl text-ink-3 [&>svg]:size-8">{icon}</div>}
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {description && <div className="mt-1 max-w-sm text-[13px] text-ink-2">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("my-6 border-line", className)} />;
}
