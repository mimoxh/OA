"use client";

import { useMemo, useState } from "react";
import { Bot, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ui/use-action";
import { resetConversationRunConfigAction, updateConversationRunConfig } from "@/app/(app)/messages/actions";
import {
  AGENT_PRESETS,
  EFFORT_LEVELS,
  MODEL_SUGGESTIONS,
  SELF_MANAGED_AGENT_HINT,
  isEmptyRunConfig,
  type ChatRunBot,
  type RunConfigPatch,
  type RunMetadata,
} from "@/lib/im/webhook-run-config";

const CUSTOM = "__custom__";
const control =
  "h-6 rounded border border-line-strong bg-white px-1.5 text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-60";

type Field = keyof RunMetadata;
type Shared = { value: string | null; mixed: boolean };

function sharedDefault(bots: ChatRunBot[], field: Field): Shared {
  const values = new Set(bots.map((b) => b.defaults[field]));
  return values.size === 1 ? { value: [...values][0], mixed: false } : { value: null, mixed: true };
}

function defaultLabel(s: Shared, fallback: string) {
  return s.value ? `默认（${s.value}）` : s.mixed ? "默认（各机器人不同）" : fallback;
}

/** 输入框上方的 Webhook 运行配置条：选择结果按会话持久化，并在出站 payload.metadata 中生效 */
export function WebhookRunConfigBar({
  conversationId,
  bots,
  initialOverride,
}: {
  conversationId: string;
  bots: ChatRunBot[];
  initialOverride: RunMetadata;
}) {
  const { run, pending } = useAction();
  const [override, setOverride] = useState<RunMetadata>(initialOverride);
  const [modelDraft, setModelDraft] = useState(initialOverride.model ?? "");
  const [customAgent, setCustomAgent] = useState<string | null>(null);

  const defaults = useMemo(
    () => ({ agent: sharedDefault(bots, "agent"), model: sharedDefault(bots, "model"), effort: sharedDefault(bots, "effort") }),
    [bots],
  );
  const effectiveAgent = override.agent ?? defaults.agent.value;
  const effectiveModel = override.model ?? defaults.model.value;
  const hint = effectiveAgent && !effectiveModel ? SELF_MANAGED_AGENT_HINT[effectiveAgent] : undefined;
  const customAgentOption = override.agent && !(AGENT_PRESETS as readonly string[]).includes(override.agent) ? override.agent : null;

  const apply = (next: RunMetadata) => {
    setOverride(next);
    setModelDraft(next.model ?? "");
  };

  const save = (patch: RunConfigPatch) => {
    const prev = override;
    setOverride({
      agent: patch.agent !== undefined ? patch.agent?.trim().toLowerCase() || null : prev.agent,
      model: patch.model !== undefined ? patch.model?.trim() || null : prev.model,
      effort: patch.effort !== undefined ? ((patch.effort || null) as RunMetadata["effort"]) : prev.effort,
    });
    void run(() => updateConversationRunConfig({ conversationId, ...patch }), { refresh: false, onSuccess: apply }).then((r) => {
      if (!r.ok) apply(prev);
    });
  };

  const reset = () => {
    const prev = override;
    apply({ agent: null, model: null, effort: null });
    setCustomAgent(null);
    void run(() => resetConversationRunConfigAction(conversationId), { refresh: false, success: "已恢复机器人默认", onSuccess: apply }).then((r) => {
      if (!r.ok) apply(prev);
    });
  };

  const commitModel = () => {
    const v = modelDraft.trim();
    if (v !== (override.model ?? "")) save({ model: v || null });
    else setModelDraft(override.model ?? "");
  };

  const commitCustomAgent = () => {
    const v = customAgent?.trim() ?? "";
    setCustomAgent(null);
    if (v && v.toLowerCase() !== override.agent) save({ agent: v });
  };

  const who = bots.length === 1 ? bots[0].name : `${bots.length} 个 Webhook 机器人`;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-sidebar px-4 py-1.5 text-xs text-ink-2"
      title="发给 Webhook 机器人的消息会在 payload.metadata 中携带当前选择；未选择的项跟随机器人默认"
    >
      <span className="inline-flex min-w-0 items-center gap-1 font-medium text-ink-2">
        <Bot className="size-3.5 shrink-0 text-ink-3" />
        <span className="max-w-[160px] truncate">{who}</span>
      </span>

      <label className="inline-flex items-center gap-1">
        <span className="text-ink-3">基座</span>
        {customAgent !== null ? (
          <input
            autoFocus
            value={customAgent}
            maxLength={40}
            placeholder="自定义基座标识"
            className={cn(control, "w-28 font-mono")}
            onChange={(e) => setCustomAgent(e.target.value)}
            onBlur={commitCustomAgent}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCustomAgent();
              if (e.key === "Escape") setCustomAgent(null);
            }}
          />
        ) : (
          <select
            aria-label="基座"
            className={control}
            disabled={pending}
            value={override.agent ?? ""}
            onChange={(e) => {
              if (e.target.value === CUSTOM) setCustomAgent("");
              else save({ agent: e.target.value || null });
            }}
          >
            <option value="">{defaultLabel(defaults.agent, "跟随 Bot 默认")}</option>
            {AGENT_PRESETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            {customAgentOption && <option value={customAgentOption}>{customAgentOption}（自定义）</option>}
            <option value={CUSTOM}>自定义…</option>
          </select>
        )}
      </label>

      <label className="inline-flex items-center gap-1">
        <span className="text-ink-3">模型</span>
        <input
          aria-label="模型"
          value={modelDraft}
          maxLength={120}
          list={`wh-models-${conversationId}`}
          placeholder={defaults.model.value ?? (defaults.model.mixed ? "各机器人默认" : "默认模型")}
          className={cn(control, "w-40 font-mono")}
          onChange={(e) => setModelDraft(e.target.value)}
          onBlur={commitModel}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setModelDraft(override.model ?? "");
          }}
        />
        <datalist id={`wh-models-${conversationId}`}>
          {MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="inline-flex items-center gap-1">
        <span className="text-ink-3">强度</span>
        <select
          aria-label="思考强度"
          className={control}
          disabled={pending}
          value={override.effort ?? ""}
          onChange={(e) => save({ effort: e.target.value || null })}
        >
          <option value="">{defaultLabel(defaults.effort, "默认")}</option>
          {EFFORT_LEVELS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>

      {hint && <span className="text-ink-3">{hint}</span>}
      <span className="flex-1" />
      {pending && <span className="text-ink-3">保存中…</span>}
      {!isEmptyRunConfig(override) && (
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-60"
          title="清除本会话的选择，恢复为机器人默认配置"
        >
          <RotateCcw className="size-3" />
          恢复机器人默认
        </button>
      )}
    </div>
  );
}
