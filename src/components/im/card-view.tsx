"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Card } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ui/use-action";
import { cardAction } from "@/app/(app)/messages/actions";

const STRIP: Record<string, string> = {
  blue: "#2383e2",
  green: "#448361",
  red: "#e03e3e",
  orange: "#e16b16",
  gray: "#787774",
};

const STATUS_CLS: Record<string, string> = {
  blue: "bg-tag-blue text-tag-blue-ink",
  green: "bg-tag-green text-tag-green-ink",
  red: "bg-tag-red text-tag-red-ink",
  orange: "bg-tag-orange text-tag-orange-ink",
  gray: "bg-tag-gray text-tag-gray-ink",
};

/** 机器人/业务卡片 */
export function CardView({ messageId, card }: { messageId: string; card: Card }) {
  const { run, pending } = useAction();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState("");

  const act = (action: "approve" | "reject", c?: string) =>
    run(() => cardAction({ messageId, action, comment: c }), {
      refresh: false,
      success: action === "approve" ? "已同意" : "已驳回",
      onSuccess: () => {
        setRejectOpen(false);
        setComment("");
      },
    });

  return (
    <div className="w-[320px] max-w-[80vw] overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <div className="h-1" style={{ backgroundColor: card.status ? STRIP[card.status.color] : "#787774" }} />
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">{card.title}</div>
          {card.status && (
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px]", STATUS_CLS[card.status.color] ?? STATUS_CLS.gray)}>
              {card.status.label}
            </span>
          )}
        </div>
        {card.body && <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{card.body}</div>}
        {!!card.fields?.length && (
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-sidebar p-2">
            {card.fields.map((f, i) => (
              <div key={i} className="contents">
                <span className="text-xs text-ink-3">{f.label}</span>
                <span className="truncate text-xs text-ink">{f.value}</span>
              </div>
            ))}
          </div>
        )}
        {card.actor && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
            <Avatar name={card.actor.name} color={card.actor.avatarColor} size={18} />
            {card.actor.name}
          </div>
        )}
        {(card.actions?.length || card.link) && (
          <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
            {card.actions?.map((a) =>
              a.key === "approve" ? (
                <button
                  key={a.key}
                  disabled={pending}
                  onClick={() => act("approve")}
                  className="h-7 flex-1 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {a.label}
                </button>
              ) : (
                <button
                  key={a.key}
                  disabled={pending}
                  onClick={() => setRejectOpen(true)}
                  className="h-7 flex-1 rounded-md border border-line-strong px-3 text-[13px] text-ink hover:bg-hover disabled:opacity-50"
                >
                  {a.label}
                </button>
              ),
            )}
            {card.link && (
              <Link
                href={card.link}
                className={cn(
                  "flex h-7 items-center justify-center gap-1 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:bg-hover",
                  card.actions?.length ? "" : "flex-1",
                )}
              >
                查看详情
                <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
        )}
      </div>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent
          title="驳回审批"
          footer={
            <>
              <button onClick={() => setRejectOpen(false)} className="h-8 rounded-md px-3 text-[13px] text-ink-2 hover:bg-hover">
                取消
              </button>
              <button
                onClick={() => act("reject", comment)}
                disabled={!comment.trim() || pending}
                className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white disabled:opacity-50"
              >
                确认驳回
              </button>
            </>
          }
        >
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="请填写驳回意见（必填）"
            className="w-full resize-none rounded-md border border-line-strong p-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
