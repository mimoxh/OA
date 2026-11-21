"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";

const PRESETS = ["价格高于竞品", "客户预算取消", "需求变更", "选择了竞争对手", "长期无回应"];

/** 输单原因弹窗（受控） */
export function LostReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  title = "标记输单",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
  title?: string;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setReason("");
        onOpenChange(v);
      }}
    >
      <DialogContent
        size="sm"
        title={title}
        description="输单后赢率归零，请记录原因以便复盘。"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>取消</Button>
            <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
              确认输单
            </Button>
          </>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setReason(p)} className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-hover">
              {p}
            </button>
          ))}
        </div>
        <Field label="输单原因" required>
          <Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}
