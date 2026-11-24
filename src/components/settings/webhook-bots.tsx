"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Activity, Bot, Copy, KeyRound, MessageSquare, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { ColorPicker } from "@/components/oa/color-picker";
import { PALETTE } from "@/lib/oa/types";
import { formatDateTime } from "@/lib/format";
import { AGENT_PRESETS, EFFORT_LEVELS, MODEL_SUGGESTIONS, SELF_MANAGED_AGENT_HINT } from "@/lib/im/webhook-run-config";
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

const CUSTOM_AGENT = "__custom__";
const isPresetAgent = (a: string) => (AGENT_PRESETS as readonly string[]).includes(a);

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

function RunConfigFields({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const agent = form.defaultAgent.trim().toLowerCase();
  const hint = agent && !form.defaultModel.trim() ? SELF_MANAGED_AGENT_HINT[agent] : undefined;
  return (
    <div className="col-span-2 rounded-md border border-line p-3">
      <div className="mb-2 text-xs font-medium text-ink-2">默认运行配置</div>
      <p className="mb-2 text-xs text-ink-3">
        随每条出站消息写入 <code>payload.metadata</code>（agent / model / effort）；聊天中可按会话临时切换，留空则跟随外部 Bot 自身默认。
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="默认基座（Agent）" hint={hint}>
          <Select
            value={form.customAgent ? CUSTOM_AGENT : form.defaultAgent}
            onChange={(e) =>
              e.target.value === CUSTOM_AGENT
                ? setForm({ ...form, customAgent: true, defaultAgent: "" })
                : setForm({ ...form, customAgent: false, defaultAgent: e.target.value })
            }
          >
            <option value="">跟随 Bot 默认</option>
            {AGENT_PRESETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            <option value={CUSTOM_AGENT}>自定义…</option>
          </Select>
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
        <Field label="默认模型（Model）" hint="Provider Model ID，留空使用基座默认">
          <Input
            value={form.defaultModel}
            maxLength={120}
            list="webhook-model-suggestions"
            className="font-mono"
            placeholder="如 claude-opus-5-5 / gpt-6-astra"
            onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
          />
          <datalist id="webhook-model-suggestions">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="默认思考强度（Effort）">
          <Select value={form.defaultEffort} onChange={(e) => setForm({ ...form, defaultEffort: e.target.value })}>
            <option value="">默认</option>
            {EFFORT_LEVELS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}

function copy(text: string, label = "已复制") {
  navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("复制失败，请手动选择复制"),
  );
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
    customAgent: !!bot.defaultAgent && !isPresetAgent(bot.defaultAgent),
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
            <Badge color={bot.defaultAgent ? "blue" : "gray"}>基座 {bot.defaultAgent ?? "默认"}</Badge>
            <Badge color={bot.defaultModel ? "blue" : "gray"}>模型 {bot.defaultModel ?? "默认"}</Badge>
            <Badge color={bot.defaultEffort ? "blue" : "gray"}>Effort {bot.defaultEffort ?? "默认"}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-ink-3">{bot.description || bot.title || "—"}</div>
          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
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
