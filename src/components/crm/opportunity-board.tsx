"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Dot } from "@/components/ui/badge";
import { useAction } from "@/components/ui/use-action";
import { OPPORTUNITY_STAGE } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UserOption } from "@/lib/crm/types";
import { changeOpportunityStage } from "@/app/(app)/crm/actions";
import { LostReasonDialog } from "@/components/crm/lost-reason-dialog";
import { OpportunityDialog } from "@/components/crm/opportunity-dialog";

type Stage = keyof typeof OPPORTUNITY_STAGE;
const STAGES = Object.keys(OPPORTUNITY_STAGE) as Stage[];

export type BoardOpportunity = {
  id: string;
  name: string;
  amount: number;
  stage: Stage;
  probability: number;
  expectedCloseDate: Date | null;
  customer: { id: string; name: string };
  owner: { name: string; avatarColor: string } | null;
};

export function OpportunityBoard({
  items,
  canEdit,
  customers,
  users,
  currentUserId,
}: {
  items: BoardOpportunity[];
  canEdit: boolean;
  customers: { id: string; name: string }[];
  users: UserOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [overrides, setOverrides] = useState<Record<string, Stage>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [lostFor, setLostFor] = useState<string | null>(null);

  const list = items.map((o) => (overrides[o.id] && overrides[o.id] !== o.stage ? { ...o, stage: overrides[o.id] } : o));
  const today = new Date().setHours(0, 0, 0, 0);

  const move = (id: string, stage: Stage, reason?: string) => {
    const prev = list.find((o) => o.id === id)?.stage;
    if (!prev || prev === stage) return;
    setOverrides((m) => ({ ...m, [id]: stage }));
    run(() => changeOpportunityStage(id, stage, reason), {
      success: `已移动到「${OPPORTUNITY_STAGE[stage].label}」`,
      onSuccess: () => setLostFor(null),
    }).then((r) => {
      if (!r.ok) setOverrides((m) => ({ ...m, [id]: prev }));
    });
  };

  return (
    <>
      <div className="-mx-6 overflow-x-auto px-6 pb-4 sm:-mx-12 sm:px-12">
        <div className="flex min-w-max gap-3">
          {STAGES.map((stage) => {
            const cards = list.filter((o) => o.stage === stage);
            const total = cards.reduce((s, o) => s + o.amount, 0);
            const meta = OPPORTUNITY_STAGE[stage];
            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  if (!canEdit || !dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overStage !== stage) setOverStage(stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setOverStage(null);
                  setDragId(null);
                  if (!id) return;
                  const cur = list.find((o) => o.id === id);
                  if (!cur || cur.stage === stage) return;
                  if (stage === "LOST") setLostFor(id);
                  else move(id, stage);
                }}
                className={cn(
                  "flex w-[264px] shrink-0 flex-col rounded-lg bg-sidebar p-2 transition-colors",
                  overStage === stage && "bg-accent-soft ring-2 ring-accent/30",
                )}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <Dot color={meta.color} />
                    {meta.label}
                    <span className="text-xs font-normal text-ink-3">{cards.length}</span>
                  </div>
                  <span className="text-xs tabular-nums text-ink-2">{formatMoney(total)}</span>
                </div>
                <div className="flex min-h-24 flex-1 flex-col gap-2">
                  {cards.map((o) => {
                    const overdue = o.expectedCloseDate && new Date(o.expectedCloseDate).getTime() < today && stage !== "WON" && stage !== "LOST";
                    return (
                      <div
                        key={o.id}
                        draggable={canEdit}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", o.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(o.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStage(null);
                        }}
                        onClick={() => router.push(`/crm/opportunities/${o.id}`)}
                        data-testid="opp-card"
                        data-id={o.id}
                        className={cn(
                          "cursor-pointer rounded-md border border-line bg-white p-2.5 shadow-card transition hover:border-line-strong hover:shadow-sm",
                          dragId === o.id && "opacity-50",
                          pending && overrides[o.id] && "animate-pulse",
                        )}
                      >
                        <div className="text-sm font-medium leading-snug text-ink">{o.name}</div>
                        <div className="mt-0.5 truncate text-xs text-ink-2">{o.customer.name}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[13px] font-semibold tabular-nums text-ink">{formatMoney(o.amount)}</span>
                          <span className="text-[11px] text-ink-3">{o.probability}%</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-ink-2">
                          <span className={cn("inline-flex items-center gap-1", overdue && "text-danger")}>
                            <CalendarDays className="size-3" />
                            {o.expectedCloseDate ? formatDate(o.expectedCloseDate, "MM-dd") : "未定"}
                          </span>
                          {o.owner ? <Avatar name={o.owner.name} color={o.owner.avatarColor} size={20} /> : <span className="text-ink-3">未分配</span>}
                        </div>
                      </div>
                    );
                  })}
                  {canEdit && stage !== "LOST" && stage !== "WON" && (
                    <OpportunityDialog
                      customers={customers}
                      users={users}
                      defaultStage={stage}
                      defaultOwnerId={currentUserId}
                      navigate={false}
                      trigger={
                        <button className="flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-ink-3 hover:bg-active hover:text-ink">
                          <Plus className="size-3.5" />
                          新建
                        </button>
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <LostReasonDialog
        open={!!lostFor}
        pending={pending}
        onOpenChange={(v) => !v && setLostFor(null)}
        onConfirm={(reason) => lostFor && move(lostFor, "LOST", reason)}
      />
    </>
  );
}
