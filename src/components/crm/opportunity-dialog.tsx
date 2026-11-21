"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { OPPORTUNITY_STAGE, OPPORTUNITY_STAGE_PROBABILITY } from "@/lib/labels";
import type { UserOption } from "@/lib/crm/types";
import { createOpportunity } from "@/app/(app)/crm/actions";

type Form = { name: string; customerId: string; amount: string; stage: string; expectedCloseDate: string; ownerId: string };

export function OpportunityDialog({
  customers,
  users,
  customerId,
  defaultStage = "QUALIFY",
  defaultOwnerId,
  navigate = true,
  trigger,
}: {
  customers: { id: string; name: string }[];
  users: UserOption[];
  customerId?: string;
  defaultStage?: string;
  defaultOwnerId?: string;
  navigate?: boolean;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank: Form = { name: "", customerId: customerId ?? "", amount: "", stage: defaultStage, expectedCloseDate: "", ownerId: defaultOwnerId ?? "" };
  const [form, setForm] = useState<Form>(blank);
  const { run, pending } = useAction();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () =>
    run(
      () =>
        createOpportunity({
          name: form.name,
          customerId: form.customerId,
          amount: form.amount || 0,
          stage: form.stage as "QUALIFY",
          expectedCloseDate: form.expectedCloseDate || null,
          ownerId: form.ownerId || null,
        }),
      {
        success: "商机已创建",
        onSuccess: (d) => {
          setOpen(false);
          if (navigate) router.push(`/crm/opportunities/${d.id}`);
        },
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setForm(blank);
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="新建商机"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              创建商机
            </Button>
          </>
        }
      >
        <form
          className="grid grid-cols-2 gap-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="商机名称" required className="col-span-2">
            <Input autoFocus value={form.name} onChange={set("name")} placeholder="例如：全员办公设备升级" />
          </Field>
          {!customerId && (
            <Field label="客户" required className="col-span-2">
              <Select value={form.customerId} onChange={set("customerId")}>
                <option value="">选择客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="预计金额（元）">
            <Input type="number" min={0} step="0.01" value={form.amount} onChange={set("amount")} />
          </Field>
          <Field label="阶段" hint={`赢率 ${OPPORTUNITY_STAGE_PROBABILITY[form.stage as keyof typeof OPPORTUNITY_STAGE] ?? 0}%`}>
            <Select value={form.stage} onChange={set("stage")}>
              {Object.entries(OPPORTUNITY_STAGE)
                .filter(([k]) => k !== "LOST")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="预计成交日期">
            <Input type="date" value={form.expectedCloseDate} onChange={set("expectedCloseDate")} />
          </Field>
          <Field label="负责人">
            <Select value={form.ownerId} onChange={set("ownerId")}>
              <option value="">未分配</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
