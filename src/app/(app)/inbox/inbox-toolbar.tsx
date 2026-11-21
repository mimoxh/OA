"use client";

import { CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { useAction } from "@/components/ui/use-action";
import { NOTIFICATION_TYPE } from "@/lib/labels";
import { clearReadNotifications, markAllNotificationsRead } from "./actions";

export function InboxToolbar({ type, unread, hasRead }: { type?: string; unread: number; hasRead: boolean }) {
  const { run, pending } = useAction();
  const changed = () => window.dispatchEvent(new Event("notifications:changed"));
  return (
    <>
      {hasRead && (
        <ConfirmButton
          variant="ghost"
          title="清除已读通知"
          description="将删除所有已读通知，未读通知会保留。"
          confirmText="清除"
          danger
          onConfirm={() => run(() => clearReadNotifications(), { success: "已清除已读通知", onSuccess: changed })}
        >
          <Trash2 className="size-3.5" />
          清除已读
        </ConfirmButton>
      )}
      <Button
        disabled={!unread}
        loading={pending}
        onClick={() =>
          run(() => markAllNotificationsRead(type), {
            success: type ? `「${NOTIFICATION_TYPE[type] ?? type}」通知已全部标为已读` : "已全部标为已读",
            onSuccess: changed,
          })
        }
      >
        <CheckCheck className="size-3.5" />
        {type ? `${NOTIFICATION_TYPE[type] ?? type}全部已读` : "全部标为已读"}
      </Button>
    </>
  );
}
