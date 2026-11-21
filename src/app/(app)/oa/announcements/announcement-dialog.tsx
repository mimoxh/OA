"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { ANNOUNCEMENT_CATEGORIES } from "@/lib/oa/types";
import { saveAnnouncement } from "./actions";

type Initial = { id: string; title: string; content: string; category: string; pinned: boolean };

export function AnnouncementDialog({ initial, children }: { initial?: Initial; children: ReactNode }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const empty = { title: "", content: "", category: "通知", pinned: false };
  const [form, setForm] = useState(initial ?? empty);
  const [notifyAll, setNotifyAll] = useState(!initial);

  const categories: string[] = [...ANNOUNCEMENT_CATEGORIES];
  if (form.category && !categories.includes(form.category)) categories.push(form.category);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(initial ?? empty);
          setNotifyAll(!initial);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        size="lg"
        title={initial ? "编辑公告" : "发布公告"}
        footer={
          <>
            <Checkbox
              label={initial ? "通知全体成员公告已更新" : "通知全体成员"}
              checked={notifyAll}
              onChange={(e) => setNotifyAll(e.target.checked)}
              className="mr-auto text-[13px]"
            />
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => saveAnnouncement({ ...form, id: initial?.id, notifyAll }), {
                  success: initial ? "公告已更新" : "公告已发布",
                  onSuccess: (d) => {
                    setOpen(false);
                    if (!initial) router.push(`/oa/announcements/${d.id}`);
                  },
                })
              }
            >
              {initial ? "保存" : "发布"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2">
          <Field label="标题" required>
            <Input autoFocus value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="公告标题" />
          </Field>
          <div className="flex items-end gap-4">
            <Field label="分类" required className="w-40">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox label="置顶公告" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="h-8" />
          </div>
          <Field label="内容" required hint="支持简单 Markdown：# 标题、- 列表、**粗体**、`代码`、[链接](https://…)、> 引用">
            <Textarea rows={12} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="公告正文…" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
