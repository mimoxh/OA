"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Brain, Check, ChevronDown, Cpu, Layers, Loader2, RotateCcw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/im/agent-icon";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
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

type Field = keyof RunMetadata;

/** 聊天页选择器与设置页共用的字段文案和图标，保持两处一致 */
export const RUN_FIELD_META: Record<Field, { label: string; title: string; icon: LucideIcon }> = {
  agent: { label: "基座", title: "基座（Agent）", icon: Layers },
  model: { label: "模型", title: "模型（Model）", icon: Cpu },
  effort: { label: "思考强度", title: "思考强度（Effort）", icon: Brain },
};

type Shared = { value: string | null; mixed: boolean };

function sharedDefault(bots: ChatRunBot[], field: Field): Shared {
  const values = new Set(bots.map((b) => b.defaults[field]));
  return values.size === 1 ? { value: [...values][0], mixed: false } : { value: null, mixed: true };
}

function defaultMeta(s: Shared) {
  return s.value ?? (s.mixed ? "各机器人不同" : "未指定");
}

/** 方向键在选项之间移动焦点（Popover 不自带列表导航） */
export function onRunListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const opts = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-run-opt]"));
  if (!opts.length) return;
  e.preventDefault();
  const i = opts.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
  opts[i < 0 ? 0 : next].focus();
}

export function RunOption({
  selected,
  onSelect,
  icon,
  meta,
  mono,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  meta?: ReactNode;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      data-run-opt=""
      onClick={onSelect}
      className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-ink outline-none hover:bg-hover focus-visible:bg-hover"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">{selected && <Check className="size-3.5 text-accent" />}</span>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-xs")}>{children}</span>
      {meta && <span className="max-w-[45%] shrink-0 truncate text-xs text-ink-3">{meta}</span>}
    </button>
  );
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
  placeholder,
  overridden,
  disabled,
  title,
  mono,
}: {
  field: Field;
  value: string | null;
  placeholder: string;
  overridden: boolean;
  disabled: boolean;
  title: string;
  mono?: boolean;
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
          // 窄屏时模型 ID 最先截断，基座次之，强度值很短保持完整
          field === "model" ? "shrink-[4]" : field === "agent" ? "shrink" : "shrink-0",
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
        <span className={cn("truncate", mono && value && "font-mono text-[11px]", !value && "text-ink-3")}>{value ?? placeholder}</span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
  );
}

/**
 * 嵌入 IM 输入框工具栏的 Webhook 运行配置：选择结果按会话持久化，并在出站 payload.metadata 中生效。
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
  const [override, setOverride] = useState<RunMetadata>(initialOverride);
  const [open, setOpen] = useState<Field | null>(null);
  const [modelDraft, setModelDraft] = useState("");
  const [agentDraft, setAgentDraft] = useState("");
  const skipCommit = useRef(false);

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
  const customAgent = override.agent && !(AGENT_PRESETS as readonly string[]).includes(override.agent) ? override.agent : null;
  const who = bots.length === 1 ? bots[0].name : `${bots.length} 个 Webhook 机器人`;

  const save = (patch: RunConfigPatch) => {
    const prev = override;
    setOverride({
      agent: patch.agent !== undefined ? patch.agent?.trim().toLowerCase() || null : prev.agent,
      model: patch.model !== undefined ? patch.model?.trim() || null : prev.model,
      effort: patch.effort !== undefined ? ((patch.effort || null) as RunMetadata["effort"]) : prev.effort,
    });
    void run(() => updateConversationRunConfig({ conversationId, ...patch }), { refresh: false, onSuccess: setOverride }).then((r) => {
      if (!r.ok) setOverride(prev);
    });
  };

  const choose = (patch: RunConfigPatch) => {
    skipCommit.current = true;
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
      skipCommit.current = false;
      setModelDraft(override.model ?? "");
      setAgentDraft("");
      setOpen(field);
      return;
    }
    setOpen(null);
    // 点击外部关闭时提交已输入的模型（与原输入框失焦即保存一致）；Esc / 选择选项时不重复提交
    if (field === "model" && !skipCommit.current && modelDraft.trim() !== (override.model ?? "")) save({ model: modelDraft.trim() || null });
  };

  const stateTitle = (field: Field) =>
    override[field] ? `${override[field]}（本会话已切换）` : `${defaultMeta(defaults[field])}（跟随机器人默认）`;

  const panel = "w-64 p-1";

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
          placeholder="默认基座"
          overridden={!!override.agent}
          disabled={pending}
          title={stateTitle("agent")}
        />
        <PopoverContent side="top" align="end" className={panel} onKeyDown={onRunListKeyDown}>
          <PanelHeader field="agent" who={who} />
          <RunOption
            selected={!override.agent}
            icon={<AgentIcon agent={defaults.agent.value} size={14} />}
            meta={defaultMeta(defaults.agent)}
            onSelect={() => choose({ agent: null })}
          >
            跟随机器人默认
          </RunOption>
          <div className="my-1 h-px bg-line" />
          {AGENT_PRESETS.map((a) => (
            <RunOption key={a} selected={override.agent === a} icon={<AgentIcon agent={a} size={14} />} onSelect={() => choose({ agent: a })}>
              {a}
            </RunOption>
          ))}
          {customAgent && (
            <RunOption selected icon={<AgentIcon agent={customAgent} size={14} />} meta="自定义" onSelect={() => choose({ agent: customAgent })}>
              {customAgent}
            </RunOption>
          )}
          <div className="my-1 h-px bg-line" />
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
        </PopoverContent>
      </Popover>

      <Popover open={open === "model"} onOpenChange={onOpenChange("model")}>
        <Pill
          field="model"
          value={effective.model}
          placeholder={selfManagedHint ? "自身配置" : "默认模型"}
          overridden={!!override.model}
          disabled={pending}
          title={selfManagedHint ?? stateTitle("model")}
          mono
        />
        <PopoverContent
          side="top"
          align="end"
          className={panel}
          onKeyDown={onRunListKeyDown}
          onEscapeKeyDown={() => {
            skipCommit.current = true;
          }}
        >
          <PanelHeader field="model" who={who} />
          <form
            className="px-1 pb-1"
            onSubmit={(e) => {
              e.preventDefault();
              choose({ model: modelDraft.trim() || null });
            }}
          >
            <Input
              autoFocus
              value={modelDraft}
              maxLength={120}
              placeholder={defaults.model.value ? `默认 ${defaults.model.value}` : "Provider Model ID，回车应用"}
              className="h-7 font-mono text-xs"
              onChange={(e) => setModelDraft(e.target.value)}
            />
          </form>
          <RunOption selected={!override.model} meta={defaultMeta(defaults.model)} onSelect={() => choose({ model: null })}>
            跟随机器人默认
          </RunOption>
          <div className="my-1 h-px bg-line" />
          {MODEL_SUGGESTIONS.map((m) => (
            <RunOption key={m} mono selected={override.model === m} onSelect={() => choose({ model: m })}>
              {m}
            </RunOption>
          ))}
          {override.model && !MODEL_SUGGESTIONS.includes(override.model) && (
            <RunOption mono selected meta="自定义" onSelect={() => choose({ model: override.model })}>
              {override.model}
            </RunOption>
          )}
          {selfManagedHint && <p className="mt-1 border-t border-line px-2 pb-0.5 pt-1.5 text-[11px] leading-relaxed text-ink-3">{selfManagedHint}</p>}
        </PopoverContent>
      </Popover>

      <Popover open={open === "effort"} onOpenChange={onOpenChange("effort")}>
        <Pill
          field="effort"
          value={effective.effort}
          placeholder="默认强度"
          overridden={!!override.effort}
          disabled={pending}
          title={stateTitle("effort")}
        />
        <PopoverContent side="top" align="end" className="w-52 p-1" onKeyDown={onRunListKeyDown}>
          <PanelHeader field="effort" who={who} />
          <RunOption selected={!override.effort} meta={defaultMeta(defaults.effort)} onSelect={() => choose({ effort: null })}>
            跟随机器人默认
          </RunOption>
          <div className="my-1 h-px bg-line" />
          {EFFORT_LEVELS.map((x) => (
            <RunOption key={x} selected={override.effort === x} onSelect={() => choose({ effort: x })}>
              {x}
            </RunOption>
          ))}
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
