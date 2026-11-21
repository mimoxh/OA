"use client";

import { useId, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { ACCOUNT_TYPE } from "@/lib/labels";
import { createAccount } from "@/app/(app)/finance/actions";

export function AccountDialog() {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ code: "", name: "", type: "EXPENSE" as keyof typeof ACCOUNT_TYPE });
  const { run, pending } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    run(() => createAccount(v), {
      success: "科目已新增",
      onSuccess: () => {
        setOpen(false);
        setV({ code: "", name: "", type: "EXPENSE" });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-3.5" />
          新增科目
        </Button>
      </DialogTrigger>
      <DialogContent
        size="sm"
        title="新增会计科目"
        description="编码唯一，建议遵循：1 资产、2 负债、4 权益、6 损益"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" type="submit" form={formId} loading={pending}>
              保存
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="space-y-3 pb-2">
          <Field label="科目编码" required hint="4-10 位数字，如 6603、660201">
            <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus inputMode="numeric" />
          </Field>
          <Field label="科目名称" required>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="如 财务费用" />
          </Field>
          <Field label="科目类别" required>
            <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as keyof typeof ACCOUNT_TYPE })}>
              {Object.entries(ACCOUNT_TYPE).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
