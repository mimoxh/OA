"use client";

import { useEffect, useRef, useState } from "react";
import { letterAnchorId } from "@/lib/pinyin";
import { letterAt, letterTarget } from "@/lib/letter-index";
import { cn } from "@/lib/utils";

/**
 * 手机通讯录右侧字母索引（微信式）：平时只是一列浅色小字母；按住或上下滑动时高亮当前字母并在屏幕中央弹出大号字母气泡，
 * 松手即消失。没有成员的字母跳到其后最近的分组。
 */
export function LetterIndex({ letters, available }: { letters: readonly string[]; available: string[] }) {
  const [active, setActive] = useState<string | null>(null);
  // 气泡淡出期间仍显示最后一个字母
  const [bubble, setBubble] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const has = new Set(available);
  const availableKey = available.join("");

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const avail = availableKey.split("");

    const jump = (letter: string | null) => {
      if (!letter || letter === last.current) return;
      last.current = letter;
      setActive(letter);
      setBubble(letter);
      const target = letterTarget(letters, avail, letter);
      if (target) document.getElementById(letterAnchorId(target))?.scrollIntoView({ block: "start", behavior: "instant" });
    };
    // 按纵坐标换算字母：手指滑出索引条左右两侧也能继续跟随
    const at = (clientY: number) => {
      const r = strip.getBoundingClientRect();
      return letterAt(letters, clientY - r.top, r.height);
    };
    const end = () => {
      last.current = null;
      setActive(null);
    };
    // touchmove 必须是非 passive 监听才能 preventDefault，避免拖动索引时页面跟着滚动
    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      jump(at(e.touches[0].clientY));
    };
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      jump(at(e.touches[0].clientY));
    };
    strip.addEventListener("touchstart", onStart, { passive: false });
    strip.addEventListener("touchmove", onMove, { passive: false });
    strip.addEventListener("touchend", end);
    strip.addEventListener("touchcancel", end);
    return () => {
      strip.removeEventListener("touchstart", onStart);
      strip.removeEventListener("touchmove", onMove);
      strip.removeEventListener("touchend", end);
      strip.removeEventListener("touchcancel", end);
    };
  }, [letters, availableKey]);

  if (!available.length) return null;
  return (
    <>
      <div
        ref={stripRef}
        data-letter-index
        data-active={active ?? undefined}
        className="fixed right-0 top-1/2 z-30 flex w-6 -translate-y-1/2 touch-none select-none flex-col items-center py-1.5 [-webkit-tap-highlight-color:transparent] md:hidden"
        onClick={(e) => {
          // 鼠标 / 无障碍点击兜底（触屏走上面的 touch 监听）
          const letter = (e.target as HTMLElement).dataset.letter;
          const target = letter && letterTarget(letters, available, letter);
          if (target) document.getElementById(letterAnchorId(target))?.scrollIntoView({ block: "start" });
        }}
        aria-label="字母索引"
      >
        {letters.map((l) => (
          <span
            key={l}
            data-letter={l}
            className={cn(
              "flex size-4 items-center justify-center rounded-full text-[10px] font-medium leading-none transition-colors duration-100",
              active === l ? "bg-accent text-white" : has.has(l) ? "text-ink-3" : "text-ink-3/40",
            )}
            style={{ marginBlock: 1 }}
          >
            {l}
          </span>
        ))}
      </div>
      <div
        aria-hidden
        data-letter-bubble
        className={cn(
          "pointer-events-none fixed left-1/2 top-1/2 z-40 flex size-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-black/65 text-[40px] font-semibold text-white transition-[opacity,transform] duration-150 md:hidden",
          active ? "scale-100 opacity-100" : "scale-90 opacity-0",
        )}
      >
        {bubble}
      </div>
    </>
  );
}
