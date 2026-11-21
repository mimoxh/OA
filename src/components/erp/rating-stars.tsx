"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingStars({ value, onChange, size = 14 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} 星`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = (
          <Star
            style={{ width: size, height: size }}
            className={cn(n <= value ? "fill-[#cb912f] text-[#cb912f]" : "fill-transparent text-line-strong")}
          />
        );
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n)} className="rounded p-0.5 hover:bg-hover" aria-label={`${n} 星`}>
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </span>
  );
}
