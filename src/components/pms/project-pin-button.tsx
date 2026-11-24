"use client";

import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/use-action";
import { setRailPin } from "@/app/(app)/work/actions";

/** 把项目固定到左侧导航栏 */
export function ProjectPinButton({ projectId, name, pinned }: { projectId: string; name: string; pinned: boolean }) {
  const { run, pending } = useAction();
  return (
    <Button
      variant="ghost"
      loading={pending}
      aria-pressed={pinned}
      title={pinned ? "从侧边栏移除" : "固定到侧边栏"}
      onClick={() =>
        run(() => setRailPin(`project:${projectId}`, !pinned), {
          success: pinned ? `已从侧边栏移除「${name}」` : `已将「${name}」固定到侧边栏`,
        })
      }
    >
      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      {pinned ? "取消固定" : "固定到侧边栏"}
    </Button>
  );
}
