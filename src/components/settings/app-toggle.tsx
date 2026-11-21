"use client";

import { Switch } from "@/components/oa/switch";
import { useAction } from "@/components/ui/use-action";
import { setAppEnabled } from "@/app/(app)/settings/actions";

export function AppToggle({ appKey, enabled, name }: { appKey: string; enabled: boolean; name: string }) {
  const { run, pending } = useAction();
  return (
    <Switch
      checked={enabled}
      disabled={pending}
      label={`${enabled ? "停用" : "启用"}${name}`}
      onChange={(v) => run(() => setAppEnabled(appKey, v), { success: v ? `已启用「${name}」` : `已停用「${name}」` })}
    />
  );
}
