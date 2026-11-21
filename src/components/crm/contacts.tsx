"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { useAction } from "@/components/ui/use-action";
import { createContact, deleteContact, setPrimaryContact, updateContact } from "@/app/(app)/crm/actions";

export type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
};

type Form = { name: string; title: string; phone: string; email: string; isPrimary: boolean };

export function ContactDialog({ customerId, contact, trigger }: { customerId: string; contact?: ContactRow; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({ name: "", title: "", phone: "", email: "", isPrimary: false });
  const { run, pending } = useAction();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () =>
    run(() => (contact ? updateContact(contact.id, form) : createContact(customerId, form)), {
      success: contact ? "联系人已更新" : "联系人已添加",
      onSuccess: () => setOpen(false),
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v)
          setForm(
            contact
              ? { name: contact.name, title: contact.title ?? "", phone: contact.phone ?? "", email: contact.email ?? "", isPrimary: contact.isPrimary }
              : { name: "", title: "", phone: "", email: "", isPrimary: false },
          );
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={contact ? "编辑联系人" : "添加联系人"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              保存
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
          <Field label="姓名" required>
            <Input autoFocus value={form.name} onChange={set("name")} />
          </Field>
          <Field label="职务">
            <Input value={form.title} onChange={set("title")} placeholder="例如：采购经理" />
          </Field>
          <Field label="电话">
            <Input value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="邮箱">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Checkbox
            className="col-span-2"
            label="设为首要联系人（销售订单默认收货人）"
            checked={form.isPrimary}
            onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
          />
          <button type="submit" className="hidden" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsPanel({ customerId, contacts, canEdit }: { customerId: string; contacts: ContactRow[]; canEdit: boolean }) {
  const { run } = useAction();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-ink-2">共 {contacts.length} 位联系人</div>
        {canEdit && (
          <ContactDialog
            customerId={customerId}
            trigger={
              <Button size="sm">
                <Plus className="size-3.5" />
                添加联系人
              </Button>
            }
          />
        )}
      </div>
      <Table>
        <THead>
          <TR>
            <TH>姓名</TH>
            <TH>职务</TH>
            <TH>电话</TH>
            <TH>邮箱</TH>
            <TH className="w-16" />
          </TR>
        </THead>
        <TBody>
          {contacts.length === 0 && <TEmpty colSpan={5}>还没有联系人</TEmpty>}
          {contacts.map((c) => (
            <TR key={c.id}>
              <TD>
                <span className="inline-flex items-center gap-2">
                  <Avatar name={c.name} size={22} color="#9b9a97" />
                  <span className="font-medium">{c.name}</span>
                  {c.isPrimary && <Badge color="yellow">首要联系人</Badge>}
                </span>
              </TD>
              <TD className="text-ink-2">{c.title ?? "—"}</TD>
              <TD className="tabular-nums">{c.phone ?? "—"}</TD>
              <TD className="text-ink-2">{c.email ?? "—"}</TD>
              <TD>
                {canEdit && (
                  <span className="flex items-center justify-end gap-0.5">
                    <ContactDialog
                      customerId={customerId}
                      contact={c}
                      trigger={
                        <IconButton aria-label="编辑联系人">
                          <Pencil className="size-3.5" />
                        </IconButton>
                      }
                    />
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton aria-label="更多">
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      </MenuTrigger>
                      <MenuContent align="end">
                        {!c.isPrimary && (
                          <MenuItem icon={<Star />} onSelect={() => run(() => setPrimaryContact(c.id), { success: "已设为首要联系人" })}>
                            设为首要联系人
                          </MenuItem>
                        )}
                        {!c.isPrimary && <MenuSeparator />}
                        <MenuItem danger icon={<Trash2 />} onSelect={() => run(() => deleteContact(c.id), { success: "联系人已删除" })}>
                          删除
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
