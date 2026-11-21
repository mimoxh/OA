"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** 列表页搜索框：同步到 URL 查询参数（默认 q），防抖 300ms */
export function SearchInput({ placeholder = "搜索…", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(param, value);
      else next.delete(param);
      next.delete("page");
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className={cn("relative block w-56", className)}>
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border border-line-strong bg-white pl-7 pr-2 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
      />
    </label>
  );
}

/** 二次确认按钮 */
export function ConfirmButton({
  title = "确认操作",
  description,
  confirmText = "确认",
  onConfirm,
  children,
  danger,
  ...buttonProps
}: Omit<ButtonProps, "onClick"> & {
  title?: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </DialogTrigger>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant={danger ? "danger" : "primary"}
              loading={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {confirmText}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

/** 链接式筛选标签：?status=xxx */
export function FilterPills({
  param = "status",
  options,
}: {
  param?: string;
  options: { value: string; label: ReactNode; count?: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? "";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {[{ value: "", label: "全部" } as { value: string; label: ReactNode; count?: number }, ...options].map((o) => (
        <button
          key={o.value}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            if (o.value) next.set(param, o.value);
            else next.delete(param);
            next.delete("page");
            router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
          }}
          className={cn(
            "flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] transition-colors",
            current === o.value ? "bg-ink text-white" : "text-ink-2 hover:bg-hover",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular-nums opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
