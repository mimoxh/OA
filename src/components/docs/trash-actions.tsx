"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { useAction } from "@/components/ui/use-action";
import { deleteDocumentForever, emptyTrash, restoreDocument } from "@/app/(app)/docs/actions";

export function TrashRowActions({ id, title, childCount }: { id: string; title: string; childCount: number }) {
  const { run, pending } = useAction();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="sm" loading={pending} onClick={() => run(() => restoreDocument(id), { success: "页面已恢复" })}>
        {!pending && <RotateCcw className="size-3.5" />}
        恢复
      </Button>
      <ConfirmButton
        size="sm"
        variant="ghost"
        danger
        title={`彻底删除「${title}」？`}
        description={childCount > 0 ? `该页面及其 ${childCount} 个子页面将被永久删除，无法恢复。` : "该页面将被永久删除，无法恢复。"}
        confirmText="彻底删除"
        onConfirm={() => run(() => deleteDocumentForever(id), { success: "已彻底删除" })}
      >
        <Trash2 className="size-3.5" />
        彻底删除
      </ConfirmButton>
    </div>
  );
}

export function EmptyTrashButton({ count }: { count: number }) {
  const { run } = useAction();
  return (
    <ConfirmButton
      variant="ghost"
      danger
      title="清空回收站？"
      description={`回收站中你有权限管理的页面（共 ${count} 个以内）将被永久删除，无法恢复。`}
      confirmText="清空"
      onConfirm={() => run(() => emptyTrash(), { success: "回收站已清空" })}
    >
      <Trash2 className="size-3.5" />
      清空回收站
    </ConfirmButton>
  );
}
