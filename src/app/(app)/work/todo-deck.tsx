"use client";

import { Children, useRef, useState, type ReactNode } from "react";
import { deckActiveIndex } from "@/lib/swipe-deck";
import { cn } from "@/lib/utils";

/** 手机工作台顶部的待办卡片：容器内左右滑动、按卡片吸附（snap-always：快速甩动也只翻一张），右侧露出下一张卡片的边缘，下方圆点指示当前位置 */
export function TodoDeck({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const single = items.length <= 1;

  const onScroll = () => {
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    setActive(
      deckActiveIndex({ scrollLeft: el.scrollLeft, maxScroll: el.scrollWidth - el.clientWidth, step: first.offsetWidth + gap, count: items.length }),
    );
  };

  return (
    <div data-todo-deck>
      <div
        ref={ref}
        onScroll={single ? undefined : onScroll}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <div key={i} data-todo-card className={cn("shrink-0 snap-start snap-always", single ? "w-full" : "w-[84%]")}>
            {item}
          </div>
        ))}
      </div>
      {!single && (
        <div className="mt-2 flex justify-center gap-1.5" role="tablist" aria-label="待办分组">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`第 ${i + 1} 组，共 ${items.length} 组`}
              onClick={() => (ref.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
              className={cn("h-1.5 rounded-full transition-all", i === active ? "w-4 bg-accent" : "w-1.5 bg-line-strong")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
