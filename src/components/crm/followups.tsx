"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { BellRing, Mail, MessageCircle, Phone, Trash2, Users, Video } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/components/ui/use-action";
import { FOLLOWUP_TYPE } from "@/lib/labels";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createFollowUp, deleteFollowUp } from "@/app/(app)/crm/actions";

export const FOLLOWUP_ICON: Record<string, ReactNode> = {
  call: <Phone />,
  visit: <Users />,
  email: <Mail />,
  meeting: <Video />,
  wechat: <MessageCircle />,
};

export type FollowUpItem = {
  id: string;
  type: string;
  content: string;
  nextAt: Date | null;
  createdAt: Date;
  userId: string;
  user: { name: string; avatarColor: string };
  customer?: { id: string; name: string } | null;
  opportunity?: { id: string; name: string } | null;
};

export function FollowUpTimeline({
  items,
  showCustomer,
  currentUserId,
  canEdit,
  empty = "暂无跟进记录",
}: {
  items: FollowUpItem[];
  showCustomer?: boolean;
  currentUserId: string;
  canEdit: boolean;
  empty?: ReactNode;
}) {
  const { run } = useAction();
  const [now] = useState(() => Date.now());
  if (!items.length) return <div className="rounded-lg border border-dashed border-line-strong py-10 text-center text-sm text-ink-3">{empty}</div>;
  return (
    <ol className="relative">
      {items.map((f, i) => (
        <li key={f.id} className="group relative flex gap-3 pb-5">
          {i < items.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line" />}
          <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink-2 [&>svg]:size-3.5">
            {FOLLOWUP_ICON[f.type] ?? <Phone />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <Avatar name={f.user.name} color={f.user.avatarColor} size={18} />
                {f.user.name}
              </span>
              <Badge>{FOLLOWUP_TYPE[f.type] ?? f.type}</Badge>
              {showCustomer && f.customer && (
                <Link href={`/crm/customers/${f.customer.id}`} className="text-ink-2 hover:text-accent hover:underline">
                  {f.customer.name}
                </Link>
              )}
              {f.opportunity && (
                <Link href={`/crm/opportunities/${f.opportunity.id}`} className="text-ink-2 hover:text-accent hover:underline">
                  💡 {f.opportunity.name}
                </Link>
              )}
              <span className="text-ink-3" title={formatDateTime(f.createdAt)}>
                {formatRelative(f.createdAt)}
              </span>
              {canEdit && f.userId === currentUserId && (
                <IconButton
                  className="ml-auto opacity-0 group-hover:opacity-100"
                  aria-label="删除跟进"
                  onClick={() => run(() => deleteFollowUp(f.id), { success: "已删除" })}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{f.content}</p>
            {f.nextAt && (
              <div
                className={cn(
                  "mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
                  new Date(f.nextAt).getTime() < now ? "bg-tag-gray text-ink-2" : "bg-tag-orange text-tag-orange-ink",
                )}
              >
                <BellRing className="size-3" />
                下次跟进 {formatDateTime(f.nextAt)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Form = { customerId: string; opportunityId: string; type: string; content: string; nextAt: string };

export function FollowUpDialog({
  customerId,
  customers,
  opportunities,
  defaultOpportunityId,
  trigger,
}: {
  customerId?: string;
  customers?: { id: string; name: string }[];
  opportunities: { id: string; name: string; customerId: string }[];
  defaultOpportunityId?: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const blank: Form = { customerId: customerId ?? "", opportunityId: defaultOpportunityId ?? "", type: "call", content: "", nextAt: "" };
  const [form, setForm] = useState<Form>(blank);
  const { run, pending } = useAction();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const opps = opportunities.filter((o) => o.customerId === form.customerId);
  const submit = () =>
    run(
      () =>
        createFollowUp({
          customerId: form.customerId,
          opportunityId: form.opportunityId || null,
          type: form.type as "call",
          content: form.content,
          nextAt: form.nextAt || null,
        }),
      { success: "跟进记录已添加", onSuccess: () => setOpen(false) },
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
        title="新增跟进"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              保存
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 pb-2">
          {!customerId && customers && (
            <Field label="客户" required className="col-span-2">
              <Select value={form.customerId} onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value, opportunityId: "" }))}>
                <option value="">选择客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="跟进方式" required>
            <Select value={form.type} onChange={set("type")}>
              {Object.entries(FOLLOWUP_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="关联商机">
            <Select value={form.opportunityId} onChange={set("opportunityId")} disabled={!form.customerId}>
              <option value="">不关联</option>
              {opps.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="跟进内容" required className="col-span-2">
            <Textarea autoFocus rows={4} value={form.content} onChange={set("content")} placeholder="沟通了什么？客户有什么反馈？" />
          </Field>
          <Field label="下次跟进时间" hint="到期前会出现在销售概览的「待跟进」列表" className="col-span-2">
            <Input type="datetime-local" value={form.nextAt} onChange={set("nextAt")} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
