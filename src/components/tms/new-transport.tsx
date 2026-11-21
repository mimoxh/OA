"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { createTransport } from "@/app/(app)/tms/actions";

type CustomerOption = { id: string; name: string; address: string | null; phone: string | null; contact: string | null };

export function NewTransportButton({ customers, origins }: { customers: CustomerOption[]; origins: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const empty = { origin: origins[0] ?? "", destination: "", consignee: "", consigneePhone: "", weight: "", customerId: "", remark: "" };
  const [v, setV] = useState(empty);
  const { run, pending } = useAction();

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setV((prev) => ({
      ...prev,
      customerId: id,
      destination: prev.destination || c?.address || "",
      consignee: prev.consignee || c?.contact || "",
      consigneePhone: prev.consigneePhone || c?.phone || "",
    }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(empty);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-3.5" />
          新建运输单
        </Button>
      </DialogTrigger>
      <DialogContent
        size="lg"
        title="新建手工运输单"
        description="不经过销售出库的运输任务，例如调拨送货、样品寄送"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => createTransport({ ...v, customerId: v.customerId || null }), {
                  success: "运输单已创建",
                  onSuccess: (d) => {
                    setOpen(false);
                    router.push(`/tms/orders/${d.id}`);
                  },
                })
              }
            >
              创建
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="客户（可选）" className="col-span-2" hint="选择客户后自动带出地址与联系人">
            <Select value={v.customerId} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">不关联客户</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="起点" required>
            <Input value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value })} list="tms-origins" />
            <datalist id="tms-origins">
              {origins.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>
          <Field label="终点" required>
            <Input value={v.destination} onChange={(e) => setV({ ...v, destination: e.target.value })} />
          </Field>
          <Field label="收货人">
            <Input value={v.consignee} onChange={(e) => setV({ ...v, consignee: e.target.value })} />
          </Field>
          <Field label="收货人电话">
            <Input value={v.consigneePhone} onChange={(e) => setV({ ...v, consigneePhone: e.target.value })} />
          </Field>
          <Field label="货物重量（kg）" required>
            <Input type="number" min={0} step="0.1" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} />
          </Field>
          <Field label="备注" className="col-span-2">
            <Textarea rows={2} value={v.remark} onChange={(e) => setV({ ...v, remark: e.target.value })} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
