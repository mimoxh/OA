"use client";

import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/use-action";
import { BIZ_META } from "@/lib/im/biz-meta";
import type { BizType } from "@/lib/im/types";
import { openBizGroup } from "@/app/(app)/messages/actions";

export function BizGroupButton({
  bizType,
  bizId,
  existingConversationId,
  size = "sm",
  variant = "default",
  onAfterNavigate,
}: {
  bizType: BizType;
  bizId: string;
  existingConversationId?: string | null;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "primary" | "ghost";
  onAfterNavigate?: () => void;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const label = existingConversationId ? `进入${BIZ_META[bizType].groupLabel}` : `创建${BIZ_META[bizType].groupLabel}`;

  const onClick = () =>
    run(() => openBizGroup({ bizType, bizId }), {
      refresh: false,
      onSuccess: (res) => {
        onAfterNavigate?.();
        router.push(`/messages/${res.conversationId}`);
      },
    });

  return (
    <Button size={size} variant={variant} loading={pending} onClick={onClick}>
      <MessagesSquare className="size-3.5" />
      {label}
    </Button>
  );
}
