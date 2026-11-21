"use client";

import { Check } from "lucide-react";
import { PALETTE } from "@/lib/oa/types";
import { cn } from "@/lib/utils";

export function ColorPicker({ value, onChange, colors = PALETTE }: { value: string; onChange: (c: string) => void; colors?: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("flex size-6 items-center justify-center rounded-full ring-offset-2 transition", value === c ? "ring-2 ring-ink/30" : "hover:scale-110")}
          style={{ backgroundColor: c }}
        >
          {value === c && <Check className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  );
}
