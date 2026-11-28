"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/im/agent-icon";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { useAction } from "@/components/ui/use-action";
import { resetConversationRunConfigAction, updateConversationRunConfig } from "@/app/(app)/messages/actions";
import { useOrcaCatalog } from "@/components/im/use-orca-catalog";
import {
  AgentOptions,
  CatalogFooter,
  EffortOptions,
  ModelOptions,
  RUN_FIELD_META,
  RunDivider,
  RunOption,
  onRunListKeyDown,
  type RunField,
} from "@/components/im/run-options";
import { agentLabel, effortChoices, findAgent, findModel } from "@/lib/im/orca-catalog-shared";
import { ORCA_AGENT_LABELS } from "@/components/im/orca-agent-icons.generated";
import { SELF_MANAGED_AGENT_HINT, isEmptyRunConfig, type ChatRunBot, type RunConfigPatch, type RunMetadata } from "@/lib/im/webhook-run-config";

// 兼容既有导入路径（设置页等）
export { RUN_FIELD_META, RunOption, onRunListKeyDown } from "@/components/im/run-options";

type Field = RunField;
type Shared = { value: string | null; mixed: boolean };

function sharedDefault(bots: ChatRunBot[], field: Field): Shared {
  const values = new Set(bots.map((b) => b.defaults[field]));
  return values.size === 1 ? { value: [...values][0], mixed: false } : { value: null, mixed: true };
}

function defaultMeta(s: Shared) {
  return s.value ?? (s.mixed ? "各机器人不同" : "未指定");
}

function PanelHeader({ field, who }: { field: Field; who: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 pb-1 pt-0.5">
      <span className="text-xs font-medium text-ink-2">{RUN_FIELD_META[field].title}</span>
      <span className="truncate text-[11px] text-ink-3">{who}</span>
    </div>
  );
}

function Pill({
  field,
  value,
  display,
  placeholder,
  overridden,
  disabled,
  title,
  mono,
  warn,
}: {
  field: Field;
  value: string | null;
  display?: string;
  placeholder: string;
  overridden: boolean;
  disabled: boolean;
  title: string;
  mono?: boolean;
  /** 当前值与所选基座 / 模型的目录不匹配（仍按原值发送，仅提示） */
  warn?: boolean;
}) {
  const Icon = RUN_FIELD_META[field].icon;
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label={`${RUN_FIELD_META[field].title}：${title}`}
        className={cn(
          "inline-flex h-7 min-w-11 max-w-48 items-center gap-1 rounded-md px-1.5 text-xs transition-colors outline-none",
          // 窄屏时只压缩模型 ID；基座名较短，单独限宽，避免「Claude」这类短名也被截断
          field === "model" ? "shrink" : field === "agent" ? "max-w-32 shrink-0" : "shrink-0",
          "focus-visible:ring-[3px] focus-visible:ring-accent/15 disabled:cursor-default",
          overridden
            ? "bg-accent-soft text-accent-hover hover:bg-accent-soft/70 data-[state=open]:bg-accent-soft/70"
            : "text-ink-2 hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink",
        )}
      >
        {field === "agent" ? (
          <AgentIcon agent={value} size={14} className={cn(!value && "text-ink-3")} />
        ) : (
          <Icon className={cn("size-3.5 shrink-0", overridden ? "text-accent" : "text-ink-3")} />
        )}
        <span className={cn("truncate", mono && value && "font-mono text-[11px]", !value && "text-ink-3", warn && "underline decoration-amber-500 decoration-dotted underline-offset-2")}>
          {value ? (display ?? value) : placeholder}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
  );
}

/** 弹层与屏幕边缘的最小间距（px） */
const EDGE = 8;
type Padding = number | { top: number; right: number; bottom: number; left: number };

/** 弹层向上展开，顶部要让开手机状态栏：手机布局下 body 的 padding-top 就是 --sat（桌面为 0） */
function popoverPadding(): Padding {
  const top = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  return { top: top + EDGE, right: EDGE, bottom: EDGE, left: EDGE };
}

// 弹层宽度不超过屏幕，高度不超过触发点上方的可用空间（放不下时内部滚动，不被状态栏 / 输入法裁切）
const POPOVER_FIT = "max-h-(--radix-popover-content-available-height) max-w-[calc(100vw-16px)] overflow-y-auto";

/**
 * 显示在 IM 输入框正上方的 Webhook 运行配置条：选择结果按会话持久化，并在出站 payload.metadata 中生效。
 * 基座 / 模型 / 强度选项来自本机 Orca（模型随基座切换，强度随模型切换），读取失败时使用预设且可手动输入。
 * 未覆盖时显示机器人默认值（中性色），会话已覆盖的项以柔和强调色胶囊显示。
 */
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
  const { catalog, loading, error, refresh } = useOrcaCatalog();
  const [override, setOverride] = useState<RunMetadata>(initialOverride);
  const [open, setOpen] = useState<Field | null>(null);
  const [agentDraft, setAgentDraft] = useState("");
  const [padding, setPadding] = useState<Padding>(EDGE);

  const defaults = useMemo(
    () => ({ agent: sharedDefault(bots, "agent"), model: sharedDefault(bots, "model"), effort: sharedDefault(bots, "effort") }),
    [bots],
  );
  const effective = {
    agent: override.agent ?? defaults.agent.value,
    model: override.model ?? defaults.model.value,
    effort: override.effort ?? defaults.effort.value,
  };
  const selfManagedHint = effective.agent && !effective.model ? SELF_MANAGED_AGENT_HINT[effective.agent] : undefined;
  const who = bots.length === 1 ? bots[0].name : `${bots.length} 个 Webhook 机器人`;

  // 目录提示：模型不在所选基座的目录中 / 强度不在所选模型的档位中（只提示，不改值）
  const agentEntry = findAgent(catalog, effective.agent);
  const modelEntry = findModel(agentEntry, effective.model);
  const modelWarn = !!(effective.model && agentEntry?.models.length && !modelEntry);
  const efforts = effortChoices(catalog, effective.agent, effective.model);
  const effortWarn = !!(effective.effort && efforts.source !== "generic" && !efforts.efforts.some((e) => e.value === effective.effort));

  const save = (patch: RunConfigPatch) => {
    const prev = override;
    setOverride({
      agent: patch.agent !== undefined ? patch.agent?.trim().toLowerCase() || null : prev.agent,
      model: patch.model !== undefined ? patch.model?.trim() || null : prev.model,
      effort: patch.effort !== undefined ? patch.effort?.trim().toLowerCase() || null : prev.effort,
    });
    void run(() => updateConversationRunConfig({ conversationId, ...patch }), { refresh: false, onSuccess: setOverride }).then((r) => {
      if (!r.ok) setOverride(prev);
    });
  };

  const choose = (patch: RunConfigPatch) => {
    setOpen(null);
    const [field, value] = Object.entries(patch)[0] as [Field, string | null];
    if ((value ?? null) !== override[field]) save(patch);
  };

  const reset = () => {
    const prev = override;
    setOverride({ agent: null, model: null, effort: null });
    void run(() => resetConversationRunConfigAction(conversationId), { refresh: false, success: "已恢复机器人默认", onSuccess: setOverride }).then(
      (r) => {
        if (!r.ok) setOverride(prev);
      },
    );
  };

  const onOpenChange = (field: Field) => (next: boolean) => {
    if (next) {
      setAgentDraft("");
      setPadding(popoverPadding());
    }
    setOpen(next ? field : null);
  };

  const stateTitle = (field: Field) =>
    override[field] ? `${override[field]}（本会话已切换）` : `${defaultMeta(defaults[field])}（跟随机器人默认）`;

  const footer = <CatalogFooter catalog={catalog} loading={loading} error={error} onRefresh={() => void refresh()} />;
  const agentName = effective.agent ? agentLabel(catalog, effective.agent, ORCA_AGENT_LABELS) : null;

  return (
    <div
      role="group"
      aria-label="Webhook 运行配置"
      className="flex min-w-0 items-center gap-0.5"
      title={`发给 ${who} 的消息会在 payload.metadata 中携带当前选择；未切换的项跟随机器人默认`}
    >
      <Popover open={open === "agent"} onOpenChange={onOpenChange("agent")}>
        <Pill
          field="agent"
          value={effective.agent}
          display={agentName ?? undefined}
          placeholder="默认基座"
          overridden={!!override.agent}
          disabled={pending}
          title={stateTitle("agent")}
        />
        <PopoverContent side="top" align="start" collisionPadding={padding} className={cn("w-72 p-1", POPOVER_FIT)} onKeyDown={onRunListKeyDown}>
          <PanelHeader field="agent" who={who} />
          <RunOption
            selected={!override.agent}
            icon={<AgentIcon agent={defaults.agent.value} size={14} />}
            meta={defaultMeta(defaults.agent)}
            onSelect={() => choose({ agent: null })}
          >
            跟随机器人默认
          </RunOption>
          <RunDivider />
          <div className="max-h-72 overflow-y-auto">
            <AgentOptions catalog={catalog} value={override.agent} onSelect={(agent) => choose({ agent })} />
          </div>
          <RunDivider />
          <form
            className="px-1 pb-0.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (agentDraft.trim()) choose({ agent: agentDraft.trim() });
            }}
          >
            <Input
              value={agentDraft}
              maxLength={40}
              placeholder="自定义基座标识，回车应用"
              className="h-7 text-xs"
              onChange={(e) => setAgentDraft(e.target.value)}
            />
          </form>
          {footer}
        </PopoverContent>
      </Popover>

      <Popover open={open === "model"} onOpenChange={onOpenChange("model")}>
        <Pill
          field="model"
          value={effective.model}
          display={modelEntry?.label}
          placeholder={selfManagedHint ? "自身配置" : "默认模型"}
          overridden={!!override.model}
          disabled={pending}
          title={modelWarn ? `${stateTitle("model")}；不在 ${agentName} 的模型目录中` : (selfManagedHint ?? stateTitle("model"))}
          mono={!modelEntry}
          warn={modelWarn}
        />
        <PopoverContent side="top" align="start" collisionPadding={padding} className={cn("w-80 p-1", POPOVER_FIT)} onKeyDown={onRunListKeyDown}>
          <PanelHeader field="model" who={who} />
          <ModelOptions
            autoFocus
            catalog={catalog}
            agent={effective.agent}
            value={override.model}
            onSelect={(model) => choose({ model })}
            clear={{ label: "跟随机器人默认", meta: defaultMeta(defaults.model) }}
          />
          {selfManagedHint && <p className="px-2 pt-1 text-[11px] leading-relaxed text-ink-3">{selfManagedHint}</p>}
          {footer}
        </PopoverContent>
      </Popover>

      <Popover open={open === "effort"} onOpenChange={onOpenChange("effort")}>
        <Pill
          field="effort"
          value={effective.effort}
          placeholder="默认强度"
          overridden={!!override.effort}
          disabled={pending}
          title={effortWarn ? `${stateTitle("effort")}；不在当前模型支持的档位中` : stateTitle("effort")}
          warn={effortWarn}
        />
        <PopoverContent side="top" align="start" collisionPadding={padding} className={cn("w-60 p-1", POPOVER_FIT)} onKeyDown={onRunListKeyDown}>
          <PanelHeader field="effort" who={who} />
          <EffortOptions
            catalog={catalog}
            agent={effective.agent}
            model={effective.model}
            value={override.effort}
            onSelect={(effort) => choose({ effort })}
            clear={{ label: "跟随机器人默认", meta: defaultMeta(defaults.effort) }}
          />
          {footer}
        </PopoverContent>
      </Popover>

      {/* 固定宽度的状态位：保存中 / 重置共用同一位置，避免布局抖动 */}
      <span className="inline-flex size-6 shrink-0 items-center justify-center">
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-ink-3" aria-label="保存中" />
        ) : (
          !isEmptyRunConfig(override) && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex size-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink"
              title="恢复机器人默认（清除本会话的切换）"
              aria-label="恢复机器人默认"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )
        )}
      </span>
    </div>
  );
}
