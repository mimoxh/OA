"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/utils";
import { createSpace, updateSpace } from "@/app/(app)/docs/actions";
import { EmojiPicker } from "./emoji-picker";

export type SpaceFormValue = {
  id?: string;
  name: string;
  icon: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
};

export function SpaceFormDialog({
  open,
  onOpenChange,
  space,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  space?: SpaceFormValue;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <SpaceForm space={space} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function SpaceForm({ space, onDone }: { space?: SpaceFormValue; onDone: () => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [v, setV] = useState<SpaceFormValue>(space ?? { name: "", icon: "📁", description: "", visibility: "PUBLIC" });
  const submit = () => {
    const payload = { name: v.name, icon: v.icon, description: v.description, visibility: v.visibility };
    if (space?.id) {
      run(() => updateSpace({ ...payload, id: space.id! }), { success: "空间已更新", onSuccess: onDone });
    } else {
      run(() => createSpace(payload), {
        success: "空间已创建",
        onSuccess: (d) => {
          onDone();
          router.push(`/docs?space=${d.id}`);
        },
      });
    }
  };
  return (
    <DialogContent
      title={space?.id ? "空间设置" : "新建空间"}
      description={space?.id ? undefined : "空间用于按团队或主题组织文档"}
      footer={
        <>
          <Button onClick={onDone}>取消</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!v.name.trim()}>
            {space?.id ? "保存" : "创建空间"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-ink-2">图标</span>
            <EmojiPicker onSelect={(icon) => setV({ ...v, icon })}>
              <button type="button" className="flex size-8 items-center justify-center rounded-md border border-line-strong text-lg hover:bg-hover">
                {v.icon}
              </button>
            </EmojiPicker>
          </div>
          <Field label="名称" required className="flex-1">
            <Input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例如：市场部" />
          </Field>
        </div>
        <Field label="描述">
          <Textarea value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} rows={2} placeholder="这个空间用来做什么？" />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-2">可见范围</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "PUBLIC", icon: Globe, label: "公开", desc: "所有拥有文档权限的成员可见" },
                { value: "PRIVATE", icon: Lock, label: "私有", desc: "仅空间成员可见" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setV({ ...v, visibility: o.value })}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                  v.visibility === o.value ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-hover",
                )}
              >
                <o.icon className="mt-0.5 size-4 text-ink-2" />
                <span>
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="block text-xs text-ink-2">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </form>
    </DialogContent>
  );
}
