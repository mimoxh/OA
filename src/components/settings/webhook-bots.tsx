"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { copyWithToast } from "@/lib/clipboard";
import { Activity, Bot, ChevronDown, Copy, KeyRound, MessageSquare, Pencil, Plus, Power, SquareTerminal, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { ColorPicker } from "@/components/oa/color-picker";
import { PALETTE } from "@/lib/oa/types";
import { formatDateTime } from "@/lib/format";
import { SELF_MANAGED_AGENT_HINT } from "@/lib/im/webhook-run-config";
import { agentLabel, effortChoices, findAgent, findModel, type OrcaCatalog } from "@/lib/im/orca-catalog-shared";
import { AgentOptions, CatalogFooter, ModelOptions, RUN_FIELD_META, RunDivider, RunOption, onRunListKeyDown } from "@/components/im/run-options";
import { useOrcaCatalog } from "@/components/im/use-orca-catalog";
import { AgentIcon } from "@/components/im/agent-icon";
import { ORCA_AGENT_LABELS } from "@/components/im/orca-agent-icons.generated";
import { cn } from "@/lib/utils";
import {
  createWebhookBotAction,
  deleteWebhookBotAction,
  pingWebhookBotAction,
  rotateWebhookTokenAction,
  setWebhookBotEnabledAction,
  updateWebhookBotAction,
  type WebhookSecretReveal,
} from "@/app/(app)/settings/webhooks/actions";

type TriggerMode = "mention_only" | "all";

export type WebhookLogRow = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  event: string | null;
  status: "SUCCESS" | "FAILED";
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  conversationId: string | null;
  createdAt: string;
};

export type WebhookBotRow = {
  id: string;
  botUserId: string;
  name: string;
  avatarColor: string;
  title: string | null;
  description: string | null;
  enabled: boolean;
  triggerMode: TriggerMode;
  outboundUrlMasked: string;
  hasSecret: boolean;
  headerNames: string[];
  tokenPrefix: string;
  replyUrl: string;
  defaultAgent: string | null;
  defaultModel: string | null;
  defaultEffort: string | null;
  createdAt: string;
  logs: WebhookLogRow[];
};


const TRIGGER_LABEL: Record<TriggerMode, string> = {
  mention_only: "群聊仅 @ 或回复时触发",
  all: "群聊所有消息触发",
};

type FormState = {
  name: string;
  avatarColor: string;
  title: string;
  description: string;
  outboundUrl: string;
  outboundSecret: string;
  outboundHeaders: string;
  triggerMode: TriggerMode;
  clearSecret: boolean;
  clearHeaders: boolean;
  defaultAgent: string;
  customAgent: boolean;
  defaultModel: string;
  defaultEffort: string;
};

const BLANK_RUN = { defaultAgent: "", customAgent: false, defaultModel: "", defaultEffort: "" };

function runConfigPayload(form: FormState) {
  return { defaultAgent: form.defaultAgent, defaultModel: form.defaultModel, defaultEffort: form.defaultEffort };
}

const pickerTrigger = cn(
  "flex h-8 w-full items-center gap-1.5 rounded-md border border-line-strong bg-white px-2.5 text-left text-sm text-ink transition-shadow",
  "focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 data-[state=open]:border-accent data-[state=open]:ring-[3px] data-[state=open]:ring-accent/15",
);

type CatalogState = ReturnType<typeof useOrcaCatalog>;

function Footer({ orca }: { orca: CatalogState }) {
  return <CatalogFooter catalog={orca.catalog} loading={orca.loading} error={orca.error} onRefresh={() => void orca.refresh()} />;
}

/** 默认基座选择器：与聊天页同一套 Popover 选项与 Orca 原版图标（原生 select 无法显示图标） */
function AgentPicker({ form, setForm, orca }: { form: FormState; setForm: (f: FormState) => void; orca: CatalogState }) {
  const [open, setOpen] = useState(false);
  const pick = (next: Partial<FormState>) => {
    setOpen(false);
    setForm({ ...form, ...next });
  };
  const agent = form.defaultAgent.trim().toLowerCase();
  const label = form.customAgent ? "自定义…" : agent ? agentLabel(orca.catalog, agent, ORCA_AGENT_LABELS) : UNSET;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`默认${RUN_FIELD_META.agent.title}：${label}`} title={agent || undefined} className={pickerTrigger}>
          {form.customAgent && !agent ? <SquareTerminal className="size-3.5 shrink-0 text-ink-3" /> : <AgentIcon agent={agent} size={14} />}
          <span className={cn("min-w-0 flex-1 truncate", !form.customAgent && !agent && "text-ink-3")}>{label}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1" onKeyDown={onRunListKeyDown}>
        <RunOption selected={!form.customAgent && !agent} icon={<AgentIcon agent={null} size={14} />} onSelect={() => pick({ customAgent: false, defaultAgent: "" })}>
          {UNSET}
        </RunOption>
        <RunDivider />
        <div className="max-h-72 overflow-y-auto">
          <AgentOptions catalog={orca.catalog} value={form.customAgent ? null : agent || null} onSelect={(a) => pick({ customAgent: false, defaultAgent: a })} />
        </div>
        <RunDivider />
        <RunOption
          selected={form.customAgent}
          icon={<SquareTerminal className="size-3.5 text-ink-3" />}
          onSelect={() => pick(form.customAgent ? {} : { customAgent: true, defaultAgent: "" })}
        >
          自定义…
        </RunOption>
        <Footer orca={orca} />
      </PopoverContent>
    </Popover>
  );
}

/** 默认模型选择器：所选基座的真实模型（可搜索），目录缺失时为常用预设；可直接输入任意模型 ID */
function ModelPicker({ form, setForm, orca }: { form: FormState; setForm: (f: FormState) => void; orca: CatalogState }) {
  const [open, setOpen] = useState(false);
  const agent = form.defaultAgent.trim().toLowerCase() || null;
  const model = form.defaultModel.trim() || null;
  const entry = findModel(findAgent(orca.catalog, agent), model);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`默认${RUN_FIELD_META.model.title}：${model ?? UNSET}`} title={model ?? undefined} className={pickerTrigger}>
          <span className={cn("min-w-0 flex-1 truncate", !model && "text-ink-3", model && !entry && "font-mono text-xs")}>
            {entry ? entry.label : (model ?? UNSET)}
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1" onKeyDown={onRunListKeyDown}>
        <ModelOptions
          autoFocus
          catalog={orca.catalog}
          agent={agent}
          value={model}
          onSelect={(m) => {
            setOpen(false);
            setForm({ ...form, defaultModel: m ?? "" });
          }}
          clear={{ label: UNSET, meta: "由基座决定" }}
        />
        <Footer orca={orca} />
      </PopoverContent>
    </Popover>
  );
}

function effortHint(catalog: OrcaCatalog | null, agent: string | null, model: string | null, value: string) {
  const { efforts, source } = effortChoices(catalog, agent, model);
  if (value && !efforts.some((e) => e.value === value) && source !== "generic") return `当前值 ${value} 不在该模型支持的档位中（仍会按原值发送）`;
  if (source === "model") return `${model} 支持 ${efforts.map((e) => e.value).join(" / ")}`;
  if (source === "none") return `${model} 不支持调节思考强度`;
  return model ? "该模型未声明档位，显示通用选项" : "随所选模型显示支持的档位";
}

function RunConfigFields({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const orca = useOrcaCatalog();
  const agent = form.defaultAgent.trim().toLowerCase() || null;
  const model = form.defaultModel.trim() || null;
  const selfManagedHint = agent && !model ? SELF_MANAGED_AGENT_HINT[agent] : undefined;
  const { efforts } = effortChoices(orca.catalog, agent, model);
  const effort = form.defaultEffort.trim().toLowerCase();
  const historyEffort = effort && !efforts.some((e) => e.value === effort) ? effort : null;
  return (
    <div className="col-span-2 rounded-md border border-line p-3">
      <div className="mb-1 text-xs font-medium text-ink-2">默认运行配置</div>
      <p className="mb-2.5 text-xs text-ink-3">
        随每条出站消息写入 <code>payload.metadata</code>（agent / model / effort）；聊天中可按会话切换，未指定的项由外部 Bot 自行决定。
        基座、模型与思考强度选项读取自本机 Orca。
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Field label={<RunFieldLabel field="agent" />}>
          <AgentPicker form={form} setForm={setForm} orca={orca} />
          {form.customAgent && (
            <Input
              className="mt-1.5 font-mono"
              value={form.defaultAgent}
              maxLength={40}
              placeholder="自定义基座标识，如 my-agent"
              onChange={(e) => setForm({ ...form, defaultAgent: e.target.value })}
            />
          )}
        </Field>
        <Field label={<RunFieldLabel field="model" />} hint={selfManagedHint ?? "留空则由基座决定"}>
          <ModelPicker form={form} setForm={setForm} orca={orca} />
        </Field>
        <Field label={<RunFieldLabel field="effort" />} hint={effortHint(orca.catalog, agent, model, effort)}>
          <Select value={effort} onChange={(e) => setForm({ ...form, defaultEffort: e.target.value })}>
            <option value="">{UNSET}</option>
            {efforts.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label !== x.value ? `${x.value}（${x.label}）` : x.value}
              </option>
            ))}
            {historyEffort && <option value={historyEffort}>{historyEffort}（当前值）</option>}
          </Select>
        </Field>
      </div>
    </div>
  );
}

const UNSET = "未指定";

function RunFieldLabel({ field }: { field: keyof typeof RUN_FIELD_META }) {
  const Icon = RUN_FIELD_META[field].icon;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5 text-ink-3" />
      默认{RUN_FIELD_META[field].title}
    </span>
  );
}

/** 列表卡片中的默认运行配置摘要，与聊天页选择器同一套图标与文案 */
function RunConfigSummary({ bot }: { bot: WebhookBotRow }) {
  const items = [
    ["agent", bot.defaultAgent],
    ["model", bot.defaultModel],
    ["effort", bot.defaultEffort],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map(([field, value]) => {
        const Icon = RUN_FIELD_META[field].icon;
        return (
          <Badge key={field} color={value ? "blue" : "gray"} className={value ? undefined : "bg-transparent text-ink-2 ring-1 ring-inset ring-line"}>
            {field === "agent" ? <AgentIcon agent={value} size={13} className="mr-1" /> : <Icon className="mr-1 size-3 opacity-70" />}
            {RUN_FIELD_META[field].label}
            <span className={cn("ml-1", value ? "font-mono" : "opacity-70")}>{value ?? UNSET}</span>
          </Badge>
        );
      })}
    </div>
  );
}

function copy(text: string, label = "已复制") {
  void copyWithToast(text, label);
}

function BotFields({ form, setForm, editing }: { form: FormState; setForm: (f: FormState) => void; editing?: WebhookBotRow }) {
  const keep = "已配置，留空则保持不变";
  return (
    <div className="grid grid-cols-2 gap-3 pb-2">
      <Field label="名称" required>
        <Input value={form.name} maxLength={30} placeholder="例如：Orca 助手" onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="副标题">
        <Input value={form.title} maxLength={30} placeholder="Webhook 机器人" onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="简介" className="col-span-2">
        <Input value={form.description} maxLength={200} placeholder="在通讯录名片中展示" onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field
        label="Outbound URL"
        required={!editing}
        className="col-span-2"
        hint={editing ? `当前：${editing.outboundUrlMasked}（留空则不修改）` : "OA 会把消息 POST 到该地址，例如 Orca webhook.call 的接收地址"}
      >
        <Input
          value={form.outboundUrl}
          placeholder={editing ? keep : "https://…"}
          className="font-mono"
          onChange={(e) => setForm({ ...form, outboundUrl: e.target.value })}
        />
      </Field>
      <Field label="签名 Secret（可选）" className="col-span-2" hint="配置后请求头附带 X-OA-Signature: sha256=HMAC-SHA256(secret, 原始请求体)">
        <Input
          type="password"
          autoComplete="new-password"
          value={form.outboundSecret}
          placeholder={editing?.hasSecret ? keep : "未配置"}
          disabled={form.clearSecret}
          className="font-mono"
          onChange={(e) => setForm({ ...form, outboundSecret: e.target.value })}
        />
      </Field>
      {editing?.hasSecret && (
        <Checkbox className="col-span-2 -mt-1" label="清除已配置的 Secret" checked={form.clearSecret} onChange={(e) => setForm({ ...form, clearSecret: e.target.checked })} />
      )}
      <Field
        label="自定义 Header（可选，JSON）"
        className="col-span-2"
        hint={editing?.headerNames.length ? `已配置：${editing.headerNames.join("、")}（留空则不修改）` : '例如 {"Authorization":"Bearer xxx"}'}
      >
        <Textarea
          rows={2}
          value={form.outboundHeaders}
          disabled={form.clearHeaders}
          className="font-mono text-xs"
          placeholder={editing?.headerNames.length ? keep : "{}"}
          onChange={(e) => setForm({ ...form, outboundHeaders: e.target.value })}
        />
      </Field>
      {!!editing?.headerNames.length && (
        <Checkbox className="col-span-2 -mt-1" label="清除已配置的自定义 Header" checked={form.clearHeaders} onChange={(e) => setForm({ ...form, clearHeaders: e.target.checked })} />
      )}
      <Field label="群聊触发方式" className="col-span-2" hint="单聊消息始终触发；机器人自己或其他机器人发送的消息永不触发">
        <Select value={form.triggerMode} onChange={(e) => setForm({ ...form, triggerMode: e.target.value as TriggerMode })}>
          <option value="mention_only">仅 @ 机器人（含 @所有人）或回复机器人消息时触发（推荐）</option>
          <option value="all">群内所有消息都触发</option>
        </Select>
      </Field>
      <RunConfigFields form={form} setForm={setForm} />
      <div className="col-span-2">
        <span className="mb-1 block text-xs font-medium text-ink-2">头像颜色</span>
        <div className="flex items-center gap-3">
          <Avatar name={form.name || "?"} color={form.avatarColor} size={36} />
          <ColorPicker value={form.avatarColor} onChange={(c) => setForm({ ...form, avatarColor: c })} />
        </div>
      </div>
    </div>
  );
}

function CodeRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-2">
        {label}
        <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => copy(value, `已复制${label}`)}>
          <Copy className="size-3" />
          复制
        </button>
      </div>
      <pre className={"overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-sidebar px-2.5 py-1.5 font-mono text-xs text-ink " + (secret ? "select-all" : "")}>
        {value}
      </pre>
    </div>
  );
}

export function SecretRevealDialog({ reveal, onClose }: { reveal: WebhookSecretReveal; onClose: () => void }) {
  const curl = [
    `curl -X POST "${reveal.replyUrl}" \\`,
    `  -H "Authorization: Bearer ${reveal.token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"conversationId":"<payload.reply.conversationId>","text":"你好，我是 ${reveal.botName}","clientMsgId":"<唯一 id，可选>"}'`,
  ].join("\n");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="lg"
        title={`「${reveal.botName}」的回调凭据`}
        description="Token 仅显示这一次，关闭后无法再次查看；遗失请轮换 Token。"
        footer={
          <Button variant="primary" onClick={onClose}>
            我已保存
          </Button>
        }
      >
        <div className="space-y-3 pb-2">
          <CodeRow label="Inbound Reply URL" value={reveal.replyUrl} />
          <CodeRow label="Bearer Token" value={reveal.token} secret />
          <CodeRow label="Typing URL（可选）" value={reveal.typingUrl} />
          <CodeRow label="测试 curl" value={curl} />
          <p className="text-xs text-ink-3">
            外部服务收到 <code>im.message.created</code> 后，用 <code>payload.reply.endpoint</code> 与该 Token 回复；
            <code>replyToId</code>、<code>threadRootId</code> 可直接取自 <code>payload.reply</code>。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewWebhookBotButton() {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState<WebhookSecretReveal | null>(null);
  const blank: FormState = {
    name: "",
    avatarColor: PALETTE[7],
    title: "",
    description: "",
    outboundUrl: "",
    outboundSecret: "",
    outboundHeaders: "",
    triggerMode: "mention_only",
    clearSecret: false,
    clearHeaders: false,
    ...BLANK_RUN,
  };
  const [form, setForm] = useState(blank);
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setForm(blank);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="primary">
            <Plus className="size-3.5" />
            新建机器人
          </Button>
        </DialogTrigger>
        <DialogContent
          size="lg"
          title="新建 Webhook 机器人"
          description="机器人会作为联系人出现在通讯录中，可单聊或被拉入群聊。"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() =>
                  run(
                    () =>
                      createWebhookBotAction({
                        name: form.name,
                        avatarColor: form.avatarColor,
                        title: form.title,
                        description: form.description,
                        outboundUrl: form.outboundUrl,
                        outboundSecret: form.outboundSecret,
                        outboundHeaders: form.outboundHeaders,
                        triggerMode: form.triggerMode,
                        ...runConfigPayload(form),
                      }),
                    {
                      success: `已创建机器人「${form.name}」`,
                      onSuccess: (r) => {
                        setOpen(false);
                        setReveal(r);
                      },
                    },
                  )
                }
              >
                创建
              </Button>
            </>
          }
        >
          <BotFields form={form} setForm={setForm} />
        </DialogContent>
      </Dialog>
      {reveal && <SecretRevealDialog reveal={reveal} onClose={() => setReveal(null)} />}
    </>
  );
}

function EditBotButton({ bot }: { bot: WebhookBotRow }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const initial: FormState = {
    name: bot.name,
    avatarColor: bot.avatarColor,
    title: bot.title ?? "",
    description: bot.description ?? "",
    outboundUrl: "",
    outboundSecret: "",
    outboundHeaders: "",
    triggerMode: bot.triggerMode,
    clearSecret: false,
    clearHeaders: false,
    defaultAgent: bot.defaultAgent ?? "",
    // 已保存的基座即使不在当前 Orca 列表中，也在选择器里作为“自定义”项回显
    customAgent: false,
    defaultModel: bot.defaultModel ?? "",
    defaultEffort: bot.defaultEffort ?? "",
  };
  const [form, setForm] = useState(initial);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(initial);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Pencil className="size-3.5" />
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent
        size="lg"
        title={`编辑「${bot.name}」`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    updateWebhookBotAction({
                      id: bot.id,
                      name: form.name,
                      avatarColor: form.avatarColor,
                      title: form.title,
                      description: form.description,
                      triggerMode: form.triggerMode,
                      outboundUrl: form.outboundUrl || undefined,
                      outboundSecret: form.outboundSecret || undefined,
                      outboundHeaders: form.outboundHeaders || undefined,
                      clearSecret: form.clearSecret,
                      clearHeaders: form.clearHeaders,
                      ...runConfigPayload(form),
                    }),
                  { success: "已保存", onSuccess: () => setOpen(false) },
                )
              }
            >
              保存
            </Button>
          </>
        }
      >
        <BotFields form={form} setForm={setForm} editing={bot} />
      </DialogContent>
    </Dialog>
  );
}

function LogsTable({ logs }: { logs: WebhookLogRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>时间</TH>
          <TH>方向</TH>
          <TH>事件</TH>
          <TH>结果</TH>
          <TH>HTTP</TH>
          <TH>耗时</TH>
          <TH>错误</TH>
        </TR>
      </THead>
      <TBody>
        {logs.length === 0 && <TEmpty colSpan={7}>暂无投递记录</TEmpty>}
        {logs.map((l) => (
          <TR key={l.id}>
            <TD className="whitespace-nowrap text-ink-2">{formatDateTime(l.createdAt)}</TD>
            <TD>{l.direction === "OUTBOUND" ? <Badge color="blue">出站</Badge> : <Badge color="purple">入站</Badge>}</TD>
            <TD className="font-mono text-xs text-ink-2">{l.event ?? "—"}</TD>
            <TD>{l.status === "SUCCESS" ? <Badge color="green">成功</Badge> : <Badge color="red">失败</Badge>}</TD>
            <TD className="tabular-nums text-ink-2">{l.httpStatus ?? "—"}</TD>
            <TD className="tabular-nums text-ink-2">{l.latencyMs != null ? `${l.latencyMs}ms` : "—"}</TD>
            <TD className="max-w-[320px] truncate text-xs text-danger" title={l.error ?? undefined}>
              {l.error ?? ""}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function BotCard({ bot }: { bot: WebhookBotRow }) {
  const { run, pending } = useAction();
  const [reveal, setReveal] = useState<WebhookSecretReveal | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={bot.name} color={bot.avatarColor} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{bot.name}</span>
            <Badge color="purple">
              <Bot className="mr-0.5 size-3" />
              Webhook
            </Badge>
            {bot.enabled ? <Badge color="green">已启用</Badge> : <Badge color="red">已停用</Badge>}
            <Badge>{TRIGGER_LABEL[bot.triggerMode]}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-ink-3">{bot.description || bot.title || "—"}</div>
          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="flex h-5 items-center text-ink-3">默认运行配置</dt>
            <dd className="min-w-0">
              <RunConfigSummary bot={bot} />
            </dd>
            <dt className="text-ink-3">Outbound URL</dt>
            <dd className="truncate font-mono text-ink-2">{bot.outboundUrlMasked}</dd>
            <dt className="text-ink-3">签名 Secret</dt>
            <dd className="text-ink-2">{bot.hasSecret ? "已配置" : "未配置"}</dd>
            <dt className="text-ink-3">自定义 Header</dt>
            <dd className="text-ink-2">{bot.headerNames.length ? bot.headerNames.join("、") : "无"}</dd>
            <dt className="text-ink-3">Reply URL</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-ink-2">{bot.replyUrl}</span>
              <button type="button" className="shrink-0 text-ink-3 hover:text-ink" aria-label="复制 Reply URL" onClick={() => copy(bot.replyUrl, "已复制 Reply URL")}>
                <Copy className="size-3" />
              </button>
            </dd>
            <dt className="text-ink-3">Bearer Token</dt>
            <dd className="font-mono text-ink-2">{bot.tokenPrefix}</dd>
            <dt className="text-ink-3">创建时间</dt>
            <dd className="text-ink-2">{formatDateTime(bot.createdAt)}</dd>
          </dl>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
        <EditBotButton bot={bot} />
        <Button
          variant="ghost"
          loading={pending}
          onClick={() =>
            run(() => pingWebhookBotAction(bot.id), {
              onSuccess: (r) =>
                r.ok
                  ? toast.success(`连通成功：HTTP ${r.httpStatus} · ${r.latencyMs}ms`)
                  : toast.error(`连通失败${r.httpStatus ? `：HTTP ${r.httpStatus}` : ""} · ${r.latencyMs}ms${r.error ? ` · ${r.error}` : ""}`),
            })
          }
        >
          <Activity className="size-3.5" />
          测试连通性
        </Button>
        <ConfirmButton
          variant="ghost"
          title={`轮换「${bot.name}」的 Token`}
          description="旧 Token 将立即失效，外部服务需要换用新 Token。"
          confirmText="轮换"
          onConfirm={() => run(() => rotateWebhookTokenAction(bot.id), { onSuccess: setReveal })}
        >
          <KeyRound className="size-3.5" />
          轮换 Token
        </ConfirmButton>
        <ConfirmButton
          variant="ghost"
          danger={bot.enabled}
          title={bot.enabled ? `停用「${bot.name}」` : `启用「${bot.name}」`}
          description={bot.enabled ? "停用后不再触发出站 Webhook，入站回复将被拒绝，且从通讯录与选人中隐藏。" : "启用后恢复收发。"}
          confirmText={bot.enabled ? "停用" : "启用"}
          onConfirm={() => run(() => setWebhookBotEnabledAction(bot.id, !bot.enabled), { success: bot.enabled ? "已停用" : "已启用" })}
        >
          <Power className="size-3.5" />
          {bot.enabled ? "停用" : "启用"}
        </ConfirmButton>
        <ConfirmButton
          variant="ghost"
          danger
          title={`删除「${bot.name}」`}
          description="删除配置与投递日志，机器人账号保留为停用状态以显示历史消息。此操作不可撤销。"
          confirmText="删除"
          onConfirm={() => run(() => deleteWebhookBotAction(bot.id), { success: "已删除" })}
        >
          <Trash2 className="size-3.5" />
          删除
        </ConfirmButton>
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => setShowLogs((v) => !v)}>
          {showLogs ? "收起日志" : `最近投递日志（${bot.logs.length}）`}
        </Button>
        {bot.enabled && (
          <LinkButton variant="default" href={`/messages?to=${bot.botUserId}`}>
            <MessageSquare className="size-3.5" />
            发消息
          </LinkButton>
        )}
      </div>
      {showLogs && (
        <div className="mt-3">
          <LogsTable logs={bot.logs} />
        </div>
      )}
      {reveal && <SecretRevealDialog reveal={reveal} onClose={() => setReveal(null)} />}
    </Card>
  );
}

export function WebhookBotList({ bots }: { bots: WebhookBotRow[] }) {
  if (!bots.length) {
    return (
      <Card className="p-4">
        <EmptyState icon={<Bot />} title="还没有 Webhook 机器人" description="点击右上角「新建机器人」，把 Orca Bot 等外部服务接入为联系人。" />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {bots.map((b) => (
        <BotCard key={b.id} bot={b} />
      ))}
      <p className="text-xs text-ink-3">
        需要通讯录名片？前往 <Link href="/contacts?dept=bots" className="text-accent hover:underline">通讯录 · Webhook 机器人</Link>。
      </p>
    </div>
  );
}
