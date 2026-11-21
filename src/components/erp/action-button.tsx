"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { useAction } from "@/components/ui/use-action";
import type { ActionResult } from "@/lib/action";

/** 调用（已绑定参数的）Server Action 的按钮，可选二次确认与成功后跳转 */
export function ActionButton({
  action,
  success,
  confirm,
  redirectTo,
  children,
  variant = "default",
  size = "sm",
  danger,
  confirmText,
}: {
  action: () => Promise<ActionResult<unknown>>;
  success?: string;
  confirm?: { title: string; description?: ReactNode };
  redirectTo?: string;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  danger?: boolean;
  confirmText?: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const go = () =>
    run(() => action(), {
      success,
      refresh: !redirectTo,
      onSuccess: () => {
        if (redirectTo) router.push(redirectTo);
      },
    });
  if (confirm) {
    return (
      <ConfirmButton
        variant={variant}
        size={size}
        title={confirm.title}
        description={confirm.description}
        confirmText={confirmText}
        danger={danger}
        onConfirm={go}
      >
        {children}
      </ConfirmButton>
    );
  }
  return (
    <Button variant={variant} size={size} loading={pending} onClick={go}>
      {children}
    </Button>
  );
}
