"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action";

type RunOptions<T> = {
  /** 成功提示文案 */
  success?: string;
  onSuccess?: (data: T) => void;
  /** 默认成功后 router.refresh() */
  refresh?: boolean;
};

/**
 * 调用 Server Action 的统一 Hook：处理 loading、错误提示和刷新。
 *   const { run, pending } = useAction();
 *   run(() => createCustomer(form), { success: "已创建", onSuccess: () => setOpen(false) });
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: RunOptions<T> = {}) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          let r: ActionResult<T>;
          try {
            r = await fn();
          } catch (e) {
            r = { ok: false, error: e instanceof Error ? e.message : "网络错误" };
          }
          if (r.ok) {
            if (opts.success) toast.success(opts.success);
            opts.onSuccess?.(r.data);
            if (opts.refresh !== false) router.refresh();
          } else {
            toast.error(r.error);
          }
          resolve(r);
        });
      }),
    [router],
  );

  return { run, pending };
}
