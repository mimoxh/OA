"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Brain, Check, Cpu, Layers, Plus, RefreshCw, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/im/agent-icon";
import { ORCA_AGENT_LABELS } from "@/components/im/orca-agent-icons.generated";
import {
  AGENT_PRESETS,
  effortChoices,
  filterModels,
  findAgent,
  modelChoices,
  type OrcaAgent,
  type OrcaCatalog,
} from "@/lib/im/orca-catalog-shared";
import { modelField } from "@/lib/im/webhook-run-config";

export type RunField = "agent" | "model" | "effort";

/** 聊天页选择器与设置页共用的字段文案和图标，保持两处一致 */
export const RUN_FIELD_META: Record<RunField, { label: string; title: string; icon: LucideIcon }> = {
  agent: { label: "基座", title: "基座（Agent）", icon: Layers },
  model: { label: "模型", title: "模型（Model）", icon: Cpu },
  effort: { label: "思考强度", title: "思考强度（Effort）", icon: Brain },
};

/** 方向键在选项之间移动焦点（Popover 不自带列表导航）；焦点在搜索框时 ↓ 进入列表 */
export function onRunListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const opts = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-run-opt]"));
  if (!opts.length) return;
  e.preventDefault();
  const i = opts.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
  opts[i < 0 ? 0 : next].focus();
  opts[i < 0 ? 0 : next].scrollIntoView({ block: "nearest" });
}

export function RunOption({
  selected,
  onSelect,
  icon,
  meta,
  mono,
  title,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  meta?: ReactNode;
  mono?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      data-run-opt=""
      title={title}
      onClick={onSelect}
      className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-ink outline-none hover:bg-hover focus-visible:bg-hover"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">{selected && <Check className="size-3.5 text-accent" />}</span>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-xs")}>{children}</span>
      {meta && <span className="max-w-[50%] shrink-0 truncate text-xs text-ink-3">{meta}</span>}
    </button>
  );
}

export const RunDivider = () => <div className="my-1 h-px bg-line" />;

function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-ink-3">{children}</div>;
}

/** 底部状态行：目录来源 / 降级说明 + 手动刷新 */
export function CatalogFooter({
  catalog,
  loading,
  error,
  onRefresh,
  note,
}: {
  catalog: OrcaCatalog | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  note?: ReactNode;
}) {
  const warn = error ? `Orca 目录加载失败（${error}），使用预设` : catalog?.warnings[0];
  return (
    <div className="mt-1 flex items-start gap-1.5 border-t border-line px-2 pb-0.5 pt-1.5 text-[11px] leading-relaxed text-ink-3">
      <span className="min-w-0 flex-1">
        {warn ? (
          <span className="inline-flex items-start gap-1" title={catalog?.warnings.join("\n")}>
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" />
            {warn}
          </span>
        ) : (
          (note ?? (catalog ? "来自本机 Orca" : loading ? "正在读取本机 Orca…" : "使用预设"))
        )}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-60"
        title="重新读取本机 Orca 的基座与模型目录"
        aria-label="刷新 Orca 目录"
      >
        <RefreshCw className={cn("size-3", loading && "animate-spin")} />
      </button>
    </div>
  );
}

function agentMeta(a: OrcaAgent): string | undefined {
  const parts: string[] = [];
  if (a.isDefault) parts.push("Orca 默认");
  if (a.models.length) parts.push(`${a.models.length} 个模型`);
  else if (a.installed) parts.push("已安装");
  return parts.join(" · ") || undefined;
}

/**
 * 基座选项：本机 Orca 检测到的基座（含模型目录中的基座）在前，其余为预设；
 * 已保存但不在列表中的历史 / 自定义基座单独回显为选中项，避免被静默替换。
 */
export function AgentOptions({
  catalog,
  value,
  onSelect,
}: {
  catalog: OrcaCatalog | null;
  value: string | null;
  onSelect: (agent: string) => void;
}) {
  const agents: OrcaAgent[] =
    catalog?.agents ??
    AGENT_PRESETS.map((id) => ({ id, label: ORCA_AGENT_LABELS[id] ?? id, installed: false, isDefault: false, modelSource: null, models: [], configured: null }));
  const detected = agents.filter((a) => a.installed || a.modelSource);
  const presets = agents.filter((a) => !a.installed && !a.modelSource);
  const extra = value && !agents.some((a) => a.id === value) ? value : null;
  const item = (a: OrcaAgent, meta?: string) => (
    <RunOption key={a.id} selected={value === a.id} icon={<AgentIcon agent={a.id} size={14} />} meta={meta} title={a.id} onSelect={() => onSelect(a.id)}>
      {a.label}
    </RunOption>
  );
  return (
    <>
      {detected.length > 0 && (
        <>
          <GroupLabel>本机 Orca</GroupLabel>
          {detected.map((a) => item(a, agentMeta(a)))}
        </>
      )}
      {presets.length > 0 && (
        <>
          {detected.length > 0 && <GroupLabel>其他预设</GroupLabel>}
          {presets.map((a) => item(a))}
        </>
      )}
      {extra && (
        <RunOption selected icon={<AgentIcon agent={extra} size={14} />} meta="自定义" onSelect={() => onSelect(extra)}>
          {extra}
        </RunOption>
      )}
    </>
  );
}

/** 搜索框中输入的文本可作为自定义模型 ID 时返回规范化结果 */
export function customModelId(text: string): string | null {
  const r = modelField.safeParse(text);
  return r.success && r.data ? r.data : null;
}

/**
 * 模型面板：搜索框兼作自定义 ID 输入（回车应用）；列表为所选基座的真实模型，目录缺失时为常用预设。
 * 已保存但不在目录中的模型回显为选中项并标注。
 */
export function ModelOptions({
  catalog,
  agent,
  value,
  onSelect,
  clear,
  autoFocus,
}: {
  catalog: OrcaCatalog | null;
  agent: string | null;
  value: string | null;
  onSelect: (model: string | null) => void;
  /** “跟随默认 / 未指定”项 */
  clear: { label: string; meta?: ReactNode };
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const { models, source } = modelChoices(catalog, agent);
  const shown = filterModels(models, query);
  const custom = customModelId(query);
  const exact = custom ? models.find((m) => m.id === custom) : undefined;
  const history = value && !models.some((m) => m.id === value) ? value : null;
  const a = findAgent(catalog, agent);
  const configured = a?.configured?.model;
  return (
    <>
      <form
        className="px-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          // 回车：完全匹配的模型 > 唯一的搜索结果 > 作为自定义 ID（列表中的“自定义 ID”项可显式选择）
          if (exact) onSelect(exact.id);
          else if (shown.length === 1) onSelect(shown[0].id);
          else if (custom) onSelect(custom);
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus={autoFocus}
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={models.length > 8 ? `搜索 ${models.length} 个模型，或输入模型 ID` : "搜索或输入模型 ID，回车应用"}
            aria-label="搜索或输入模型 ID"
            className="h-7 w-full rounded-md border border-line-strong bg-white pl-7 pr-2 font-mono text-xs text-ink placeholder:font-sans placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
      </form>
      {!query && (
        <>
          <RunOption selected={!value} meta={clear.meta} onSelect={() => onSelect(null)}>
            {clear.label}
          </RunOption>
          <RunDivider />
        </>
      )}
      <div className="max-h-64 overflow-y-auto">
        {history && !query && (
          <RunOption selected mono meta="不在当前目录" title={history} onSelect={() => onSelect(history)}>
            {history}
          </RunOption>
        )}
        {shown.map((m) => (
          <RunOption
            key={m.id}
            selected={value === m.id}
            title={[m.id, m.description].filter(Boolean).join("\n")}
            meta={
              <span className="inline-flex items-center gap-1">
                {m.isDefault && <span className="rounded bg-hover px-1 text-[10px] text-ink-2">默认</span>}
                {configured === m.id && !m.isDefault && <span className="rounded bg-hover px-1 text-[10px] text-ink-2">Orca 当前</span>}
                {m.label !== m.id && <span className="truncate font-mono text-[11px]">{m.id}</span>}
              </span>
            }
            onSelect={() => onSelect(m.id)}
          >
            {m.label}
          </RunOption>
        ))}
        {custom && !exact && (
          <RunOption selected={false} mono icon={<Plus className="size-3.5 text-ink-3" />} meta="自定义 ID" onSelect={() => onSelect(custom)}>
            {custom}
          </RunOption>
        )}
        {query && !shown.length && !custom && <div className="px-2 py-1.5 text-xs text-ink-3">没有匹配的模型；模型 ID 只能包含字母、数字和 . _ - : / @ +</div>}
      </div>
      <p className="px-2 pt-1 text-[11px] text-ink-3">
        {source === "preset"
          ? agent
            ? `本机 Orca 未提供 ${a?.label ?? agent} 的模型目录，显示常用模型，可直接输入 ID`
            : "未指定基座，显示常用模型，可直接输入 ID"
          : `${a?.label ?? agent} · ${models.length} 个模型（Orca ${source === "live" ? "实时探测" : "模型目录"}）`}
      </p>
    </>
  );
}

/** 思考强度选项：跟随所选模型声明的档位；模型未声明时显示通用档位；历史值不在列表中时单独回显 */
export function EffortOptions({
  catalog,
  agent,
  model,
  value,
  onSelect,
  clear,
}: {
  catalog: OrcaCatalog | null;
  agent: string | null;
  model: string | null;
  value: string | null;
  onSelect: (effort: string | null) => void;
  clear: { label: string; meta?: ReactNode };
}) {
  const { efforts, source } = effortChoices(catalog, agent, model);
  const history = value && !efforts.some((e) => e.value === value) ? value : null;
  return (
    <>
      <RunOption selected={!value} meta={clear.meta} onSelect={() => onSelect(null)}>
        {clear.label}
      </RunOption>
      <RunDivider />
      {efforts.map((e) => (
        <RunOption key={e.value} selected={value === e.value} meta={e.label !== e.value ? e.label : undefined} onSelect={() => onSelect(e.value)}>
          {e.value}
        </RunOption>
      ))}
      {history && (
        <RunOption selected meta={source === "none" ? "模型不支持" : source === "model" ? "不在当前模型档位" : "自定义"} onSelect={() => onSelect(history)}>
          {history}
        </RunOption>
      )}
      <p className="px-2 pt-1 text-[11px] leading-relaxed text-ink-3">
        {source === "model"
          ? `${model} 支持的档位`
          : source === "none"
            ? `${model} 不支持调节思考强度`
            : model
              ? "该模型未声明档位，显示通用选项"
              : "未指定模型，显示通用选项"}
      </p>
    </>
  );
}
