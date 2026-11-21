"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/common";
import { useAction } from "@/components/ui/use-action";
import { deleteOpportunity } from "@/app/(app)/crm/actions";

export function DeleteOpportunityButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ConfirmButton
      danger
      title="删除商机"
      description={`确定删除商机「${name}」吗？关联的跟进记录会保留但不再关联该商机。`}
      confirmText="删除"
      onConfirm={() =>
        run(() => deleteOpportunity(id), {
          success: "商机已删除",
          refresh: false,
          onSuccess: () => router.push("/crm/opportunities"),
        })
      }
    >
      <Trash2 className="size-3.5" />
      删除
    </ConfirmButton>
  );
}
