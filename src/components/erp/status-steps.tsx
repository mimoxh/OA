import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** 单据状态步骤条 */
export function StatusSteps({
  steps,
  current,
  aborted,
}: {
  steps: readonly { key: string; label: string }[];
  current: string;
  /** 已取消 / 已驳回等终止状态的文案，显示在步骤条末尾 */
  aborted?: string | null;
}) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-sidebar/60 px-4 py-3">
      {steps.map((s, i) => {
        const done = idx > i || (idx === steps.length - 1 && i === idx);
        const active = i === idx && !done;
        return (
          <div key={s.key} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                done && "border-[#448361] bg-[#448361] text-white",
                active && !aborted && "border-accent bg-accent text-white",
                active && aborted && "border-line-strong bg-white text-ink-2",
                !done && !active && "border-line-strong bg-white text-ink-3",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("whitespace-nowrap text-[13px]", done || active ? "text-ink" : "text-ink-3", active && !aborted && "font-medium")}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className={cn("h-px min-w-4 flex-1", idx > i ? "bg-[#448361]" : "bg-line-strong")} />}
          </div>
        );
      })}
      {aborted && (
        <span className="ml-3 shrink-0 rounded bg-tag-red px-2 py-0.5 text-xs text-tag-red-ink">{aborted}</span>
      )}
    </div>
  );
}
