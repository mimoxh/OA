"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { CUSTOMER_LEVEL, CUSTOMER_STATUS } from "@/lib/labels";
import { CUSTOMER_INDUSTRIES, CUSTOMER_SOURCES, type UserOption } from "@/lib/crm/types";
import { createCustomer, updateCustomer } from "@/app/(app)/crm/actions";

export type CustomerFormValue = {
  name: string;
  industry: string;
  level: string;
  status: string;
  source: string;
  phone: string;
  email: string;
  address: string;
  remark: string;
  ownerId: string;
};

const EMPTY: CustomerFormValue = {
  name: "",
  industry: "",
  level: "B",
  status: "LEAD",
  source: "",
  phone: "",
  email: "",
  address: "",
  remark: "",
  ownerId: "",
};

export function CustomerDialog({
  users,
  customerId,
  initial,
  defaultOwnerId,
  trigger,
}: {
  users: UserOption[];
  customerId?: string;
  initial?: CustomerFormValue;
  defaultOwnerId?: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormValue>(EMPTY);
  const { run, pending } = useAction();
  const set = (k: keyof CustomerFormValue) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    const payload = { ...form, level: form.level as "A", status: form.status as "LEAD" };
    if (customerId) {
      run(() => updateCustomer(customerId, payload), { success: "客户已更新", onSuccess: () => setOpen(false) });
    } else {
      run(() => createCustomer(payload), {
        success: "客户已创建",
        onSuccess: (d) => {
          setOpen(false);
          router.push(`/crm/customers/${d.id}`);
        },
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setForm(initial ?? { ...EMPTY, ownerId: defaultOwnerId ?? "" });
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="lg"
        title={customerId ? "编辑客户" : "新建客户"}
        description={customerId ? undefined : "客户编码将自动生成"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              {customerId ? "保存" : "创建客户"}
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
          <Field label="客户名称" required className="col-span-2">
            <Input autoFocus value={form.name} onChange={set("name")} placeholder="例如：上海星辰网络科技有限公司" />
          </Field>
          <Field label="行业">
            <Input list="crm-industries" value={form.industry} onChange={set("industry")} placeholder="选择或输入" />
            <datalist id="crm-industries">
              {CUSTOMER_INDUSTRIES.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </Field>
          <Field label="来源">
            <Select value={form.source} onChange={set("source")}>
              <option value="">未知</option>
              {CUSTOMER_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="客户等级">
            <Select value={form.level} onChange={set("level")}>
              {Object.entries(CUSTOMER_LEVEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="客户状态">
            <Select value={form.status} onChange={set("status")}>
              {Object.entries(CUSTOMER_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="电话">
            <Input value={form.phone} onChange={set("phone")} placeholder="座机或手机" />
          </Field>
          <Field label="邮箱">
            <Input type="email" value={form.email} onChange={set("email")} />
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
          <Field label="地址">
            <Input value={form.address} onChange={set("address")} />
          </Field>
          <Field label="备注" className="col-span-2">
            <Textarea value={form.remark} onChange={set("remark")} rows={3} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
