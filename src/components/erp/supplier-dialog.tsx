"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Label, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { RatingStars } from "@/components/erp/rating-stars";
import { saveSupplier } from "@/app/(app)/erp/actions";

export type SupplierFormData = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  rating: number;
  remark: string | null;
};

function initial(s?: SupplierFormData) {
  return {
    name: s?.name ?? "",
    contact: s?.contact ?? "",
    phone: s?.phone ?? "",
    email: s?.email ?? "",
    address: s?.address ?? "",
    rating: s?.rating ?? 3,
    remark: s?.remark ?? "",
  };
}

export function SupplierDialog({ supplier, trigger }: { supplier?: SupplierFormData; trigger: ReactNode }) {
  const formId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => initial(supplier));
  const { run, pending } = useAction();
  const set = (k: "name" | "contact" | "phone" | "email" | "address" | "remark") => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    run(() => saveSupplier({ id: supplier?.id, ...v }), {
      success: supplier ? "供应商已更新" : "供应商已创建",
      onSuccess: (d) => {
        setOpen(false);
        if (!supplier) router.push(`/erp/suppliers/${d.id}`);
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(initial(supplier));
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={supplier ? "编辑供应商" : "新建供应商"}
        description={supplier ? undefined : "保存后自动生成供应商编码"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" type="submit" form={formId} loading={pending}>
              保存
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="grid grid-cols-2 gap-3 pb-2">
          <Field label="供应商名称" required className="col-span-2">
            <Input value={v.name} onChange={set("name")} autoFocus />
          </Field>
          <Field label="联系人">
            <Input value={v.contact} onChange={set("contact")} />
          </Field>
          <Field label="电话">
            <Input value={v.phone} onChange={set("phone")} />
          </Field>
          <Field label="邮箱">
            <Input value={v.email} onChange={set("email")} />
          </Field>
          <div>
            <Label>评级</Label>
            <div className="flex h-8 items-center">
              <RatingStars value={v.rating} size={18} onChange={(rating) => setV((s) => ({ ...s, rating }))} />
            </div>
          </div>
          <Field label="地址" className="col-span-2">
            <Input value={v.address} onChange={set("address")} />
          </Field>
          <Field label="备注" className="col-span-2">
            <Textarea value={v.remark} onChange={set("remark")} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
