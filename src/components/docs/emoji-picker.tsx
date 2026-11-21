"use client";

import { useState, type ReactNode } from "react";
import { Shuffle, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { EMOJI_GROUPS, randomEmoji } from "@/lib/docs/constants";

export function EmojiPicker({
  children,
  onSelect,
  onRemove,
  align = "start",
}: {
  children: ReactNode;
  onSelect: (emoji: string) => void;
  onRemove?: () => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const pick = (e: string) => {
    onSelect(e);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[13px] font-medium text-ink">选择图标</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => pick(randomEmoji())}
              className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-2 hover:bg-hover"
            >
              <Shuffle className="size-3.5" />
              随机
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => {
                  onRemove();
                  setOpen(false);
                }}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-2 hover:bg-hover"
              >
                <Trash2 className="size-3.5" />
                移除
              </button>
            )}
          </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto px-2 py-2">
          {EMOJI_GROUPS.map((g) => (
            <div key={g.label} className="mb-2">
              <div className="px-1 pb-1 text-[11px] font-medium text-ink-3">{g.label}</div>
              <div className="grid grid-cols-10 gap-0.5">
                {g.items.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => pick(e)}
                    className="flex size-[30px] items-center justify-center rounded text-xl hover:bg-hover"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
