"use client";

import { Switch } from "@/components/oa/switch";
import { useAction } from "@/components/ui/use-action";
import { setFlowEnabled } from "./actions";

export function FlowToggle({ id, enabled, name }: { id: string; enabled: boolean; name: string }) {
  const { run, pending } = useAction();
  return (
    <Switch
      checked={enabled}
      disabled={pending}
      label={`${enabled ? "停用" : "启用"}${name}`}
      onChange={(v) => run(() => setFlowEnabled(id, v), { success: v ? `已启用「${name}」` : `已停用「${name}」` })}
    />
  );
}
