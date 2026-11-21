"use client";

import { useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { decideApproval, withdrawMyApproval } from "../actions";

export function DecisionBar({ instanceId, stepName }: { instanceId: string; stepName: string }) {
  const { run, pending } = useAction();
  const [mode, setMode] = useState<"APPROVE" | "REJECT" | null>(null);
  const [comment, setComment] = useState("");
  const reject = mode === "REJECT";

  const submit = () => {
    if (!mode) return;
    run(() => decideApproval({ instanceId, action: mode, comment: comment.trim() || undefined }), {
      success: reject ? "已驳回" : "已同意",
      onSuccess: () => {
        setMode(null);
        setComment("");
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
      <div className="text-sm">
        <div className="font-medium text-ink">等待你审批</div>
        <div className="text-[13px] text-ink-2">当前节点：{stepName}</div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="danger" size="md" onClick={() => setMode("REJECT")}>
          <X className="size-3.5" />
          驳回
        </Button>
        <Button variant="primary" size="md" onClick={() => setMode("APPROVE")}>
          <Check className="size-3.5" />
          同意
        </Button>
      </div>
      <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent
          size="sm"
          title={reject ? "驳回审批" : "同意审批"}
          description={reject ? "驳回后审批单将结束，申请人会收到通知。" : "同意后将流转到下一个审批节点。"}
          footer={
            <>
              <Button onClick={() => setMode(null)}>取消</Button>
              <Button variant={reject ? "danger" : "primary"} loading={pending} disabled={reject && !comment.trim()} onClick={submit}>
                {reject ? "确认驳回" : "确认同意"}
              </Button>
            </>
          }
        >
          <Textarea
            autoFocus
            rows={4}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
            placeholder={reject ? "请填写驳回原因（必填）" : "审批意见（选填）"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WithdrawButton({ instanceId }: { instanceId: string }) {
  const { run } = useAction();
  return (
    <ConfirmButton
      title="撤回审批"
      description="撤回后审批流程将终止，可以修改后重新发起。"
      confirmText="撤回"
      danger
      onConfirm={() => run(() => withdrawMyApproval(instanceId), { success: "已撤回" })}
    >
      <Undo2 className="size-3.5" />
      撤回
    </ConfirmButton>
  );
}
