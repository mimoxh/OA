"use client";

import { useState } from "react";
import { Check, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/use-action";
import { OPPORTUNITY_STAGE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { changeOpportunityStage } from "@/app/(app)/crm/actions";
import { LostReasonDialog } from "@/components/crm/lost-reason-dialog";

type Stage = keyof typeof OPPORTUNITY_STAGE;
const FLOW: Stage[] = ["QUALIFY", "NEEDS", "PROPOSAL", "NEGOTIATION", "WON"];

/** 阶段进度条：点击推进 */
export function StageProgress({ id, stage, lostReason, canEdit }: { id: string; stage: Stage; lostReason: string | null; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [lostOpen, setLostOpen] = useState(false);
  const idx = FLOW.indexOf(stage);
  const go = (s: Stage, reason?: string) =>
    run(() => changeOpportunityStage(id, s, reason), {
      success: `阶段已更新为「${OPPORTUNITY_STAGE[s].label}」`,
      onSuccess: () => setLostOpen(false),
    });

  return (
    <div>
      <div className="flex items-stretch gap-1">
        {FLOW.map((s, i) => {
          const done = stage !== "LOST" && i < idx;
          const current = s === stage;
          return (
            <button
              key={s}
              type="button"
              disabled={!canEdit || pending || current}
              onClick={() => go(s)}
              title={canEdit && !current ? `推进到「${OPPORTUNITY_STAGE[s].label}」` : undefined}
              className={cn(
                "relative flex h-8 flex-1 items-center justify-center gap-1 text-[13px] font-medium transition-colors first:rounded-l-md last:rounded-r-md disabled:cursor-default",
                current && s === "WON" && "bg-[#448361] text-white",
                current && s !== "WON" && "bg-accent text-white",
                done && "bg-accent-soft text-accent",
                !current && !done && "bg-hover text-ink-2",
                canEdit && !current && "hover:bg-active hover:text-ink",
              )}
            >
              {done && <Check className="size-3.5" />}
              {OPPORTUNITY_STAGE[s].label}
            </button>
          );
        })}
      </div>
      {stage === "LOST" ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-tag-red/60 px-3 py-2 text-sm text-tag-red-ink">
          <span className="inline-flex items-center gap-1.5">
            <XCircle className="size-4" />
            已输单{lostReason ? `：${lostReason}` : ""}
          </span>
          {canEdit && (
            <Button size="xs" variant="default" loading={pending} onClick={() => go("QUALIFY")}>
              <RotateCcw className="size-3" />
              重新激活
            </Button>
          )}
        </div>
      ) : (
        canEdit &&
        stage !== "WON" && (
          <div className="mt-2 flex justify-end">
            <Button size="xs" variant="ghost" className="text-danger" onClick={() => setLostOpen(true)}>
              <XCircle className="size-3.5" />
              标记输单
            </Button>
          </div>
        )
      )}
      <LostReasonDialog open={lostOpen} onOpenChange={setLostOpen} pending={pending} onConfirm={(r) => go("LOST", r)} />
    </div>
  );
}
