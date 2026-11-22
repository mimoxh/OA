"use client";

import { Pin, PinOff } from "lucide-react";
import { useAction } from "@/components/ui/use-action";
import { setRailPin } from "./actions";

export function RailPinButton({ appKey, label, pinned }: { appKey: string; label: string; pinned: boolean }) {
  const { run, pending } = useAction();
  const title = pinned ? "从侧边栏移除" : "添加到侧边栏";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => setRailPin(appKey, !pinned), { success: pinned ? `已从侧边栏移除「${label}」` : `已将「${label}」添加到侧边栏` })}
      title={title}
      aria-label={`${title}：${label}`}
      aria-pressed={pinned}
      className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-sidebar text-ink-3 opacity-0 transition-opacity hover:bg-active hover:text-ink focus-visible:opacity-100 disabled:opacity-50 group-hover/tile:opacity-100 [&>svg]:size-3.5"
    >
      {pinned ? <PinOff /> : <Pin />}
    </button>
  );
}
