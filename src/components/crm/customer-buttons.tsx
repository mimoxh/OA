"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/common";
import { useAction } from "@/components/ui/use-action";
import { deleteCustomer } from "@/app/(app)/crm/actions";

export function DeleteCustomerButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ConfirmButton
      danger
      title="删除客户"
      description={`确定删除客户「${name}」吗？其联系人、商机和跟进记录将一并删除，此操作不可恢复。`}
      confirmText="删除"
      onConfirm={() =>
        run(() => deleteCustomer(id), {
          success: "客户已删除",
          refresh: false,
          onSuccess: () => router.push("/crm/customers"),
        })
      }
    >
      <Trash2 className="size-3.5" />
      删除
    </ConfirmButton>
  );
}
