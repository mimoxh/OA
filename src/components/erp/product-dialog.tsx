"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { saveProduct } from "@/app/(app)/erp/actions";

export type ProductFormData = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  spec: string | null;
  price: number;
  cost: number;
  weight: number;
  safetyStock: number;
};

function initial(p?: ProductFormData) {
  return {
    sku: p?.sku ?? "",
    name: p?.name ?? "",
    category: p?.category ?? "",
    unit: p?.unit ?? "件",
    spec: p?.spec ?? "",
    price: p ? String(p.price) : "",
    cost: p ? String(p.cost) : "",
    weight: p ? String(p.weight) : "0",
    safetyStock: p ? String(p.safetyStock) : "0",
  };
}

const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

export function ProductDialog({ product, categories, trigger }: { product?: ProductFormData; categories: string[]; trigger: ReactNode }) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => initial(product));
  const { run, pending } = useAction();
  const set = (k: keyof ReturnType<typeof initial>) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    run(
      () =>
        saveProduct({
          id: product?.id,
          sku: v.sku,
          name: v.name,
          category: v.category,
          unit: v.unit,
          spec: v.spec,
          price: num(v.price),
          cost: num(v.cost),
          weight: num(v.weight),
          safetyStock: num(v.safetyStock),
        }),
      { success: product ? "产品已更新" : "产品已创建", onSuccess: () => setOpen(false) },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(initial(product));
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={product ? `编辑产品 · ${product.name}` : "新建产品"}
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
          <Field label="SKU" required hint="唯一编码，如 NB-001">
            <Input value={v.sku} onChange={set("sku")} autoFocus placeholder="NB-001" />
          </Field>
          <Field label="产品名称" required>
            <Input value={v.name} onChange={set("name")} />
          </Field>
          <Field label="分类">
            <Input value={v.category} onChange={set("category")} list={`${formId}-cats`} placeholder="选择或输入分类" />
            <datalist id={`${formId}-cats`}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="单位" required>
            <Input value={v.unit} onChange={set("unit")} placeholder="件 / 台 / 箱" />
          </Field>
          <Field label="规格型号" className="col-span-2">
            <Input value={v.spec} onChange={set("spec")} />
          </Field>
          <Field label="售价（元）" required>
            <Input type="number" step="0.01" min="0" value={v.price} onChange={set("price")} />
          </Field>
          <Field label="成本（元）" required hint="入库时按移动加权平均自动更新">
            <Input type="number" step="0.01" min="0" value={v.cost} onChange={set("cost")} />
          </Field>
          <Field label="单位重量（kg）" hint="用于运输单计算货重">
            <Input type="number" step="0.01" min="0" value={v.weight} onChange={set("weight")} />
          </Field>
          <Field label="安全库存" hint="总库存低于该值时预警">
            <Input type="number" step="1" min="0" value={v.safetyStock} onChange={set("safetyStock")} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
