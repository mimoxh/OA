"use client";

import { useRef, useState } from "react";
import { letterAnchorId } from "@/lib/pinyin";
import { cn } from "@/lib/utils";

/** 手机通讯录右侧字母索引：点按或上下滑动跳到对应分组，没有成员的字母跳到其后最近的分组 */
export function LetterIndex({ letters, available }: { letters: readonly string[]; available: string[] }) {
  const [active, setActive] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const has = new Set(available);

  const jump = (letter: string) => {
    if (letter === last.current) return;
    last.current = letter;
    setActive(letter);
    const from = letters.indexOf(letter);
    const target = letters.slice(from).find((l) => has.has(l)) ?? [...letters.slice(0, from)].reverse().find((l) => has.has(l));
    if (target) document.getElementById(letterAnchorId(target))?.scrollIntoView({ block: "start" });
  };

  const fromPoint = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const letter = el?.dataset.letter;
    if (letter) jump(letter);
  };

  const end = () => {
    last.current = null;
    setActive(null);
  };

  if (!available.length) return null;
  return (
    <>
      <div
        className="fixed right-0.5 top-1/2 z-30 flex -translate-y-1/2 touch-none select-none flex-col items-center py-1 md:hidden"
        onTouchStart={(e) => fromPoint(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => fromPoint(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={end}
        onTouchCancel={end}
        onClick={(e) => {
          const letter = (e.target as HTMLElement).dataset.letter;
          if (letter) jump(letter);
          end();
        }}
        aria-label="字母索引"
      >
        {letters.map((l) => (
          <span
            key={l}
            data-letter={l}
            className={cn(
              "flex h-[18px] w-6 items-center justify-center text-[11px] font-medium leading-none",
              has.has(l) ? "text-ink-2" : "text-ink-3/50",
              active === l && "rounded-full bg-accent text-white",
            )}
          >
            {l}
          </span>
        ))}
      </div>
      {active && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-40 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-black/60 text-3xl font-semibold text-white md:hidden">
          {active}
        </div>
      )}
    </>
  );
}
