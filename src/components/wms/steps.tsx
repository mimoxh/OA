import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** 横向状态步骤条；current 为当前步骤下标，cancelled 时整体置灰 */
export function Steps({ steps, current, cancelled }: { steps: { label: string; hint?: string }[]; current: number; cancelled?: boolean }) {
  return (
    <ol className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-3">
      {steps.map((s, i) => {
        const done = !cancelled && i < current;
        const active = !cancelled && i === current;
        return (
          <li key={s.label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                done && "border-[#448361] bg-[#448361] text-white",
                active && "border-accent bg-accent text-white",
                !done && !active && "border-line-strong text-ink-3",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate text-sm", done || active ? "text-ink" : "text-ink-3", active && "font-medium")}>{s.label}</span>
              {s.hint && <span className="block truncate text-xs text-ink-3">{s.hint}</span>}
            </span>
            {i < steps.length - 1 && <span className={cn("mx-1 h-px min-w-6 flex-1", done ? "bg-[#448361]" : "bg-line-strong")} />}
          </li>
        );
      })}
    </ol>
  );
}
