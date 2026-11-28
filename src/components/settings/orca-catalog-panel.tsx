"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, FileUp, KeyRound, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { copyWithToast } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { AgentIcon } from "@/components/im/agent-icon";
import { loadOrcaCatalog, useOrcaCatalog } from "@/components/im/use-orca-catalog";
import { formatSyncTime, originText, relativeTime } from "@/lib/im/orca-catalog-shared";
import {
  addOrcaCustomModelAction,
  deleteOrcaSnapshotAction,
  removeOrcaCustomModelAction,
  revealOrcaSyncKeyAction,
  rotateOrcaSyncKeyAction,
} from "@/app/(app)/settings/webhooks/actions";

export type OrcaSnapshotRow = { host: string; label: string | null; agentCount: number; modelCount: number; syncedAt: string; via: string };
export type OrcaCustomModelRow = { id: string; agent: string; modelId: string; label: string | null; efforts: string[]; defaultEffort: string | null };
export type OrcaSyncKeyRow = { exists: boolean; prefix: string | null; createdAt: string | null; lastUsedAt: string | null };

const VIA_LABEL: Record<string, string> = { token: "同步命令", session: "设置页导入", local: "本机 Orca" };
const SHELLS = [
  { key: "windows", label: "Windows PowerShell" },
  { key: "unix", label: "macOS / Linux" },
  { key: "repo", label: "OA 仓库内" },
] as const;
type Shell = (typeof SHELLS)[number]["key"];

const noop = () => () => {};

export function syncCommand(shell: Shell, base: string, token: string): string {
  const script = `${base}/api/im/webhooks/orca-catalog/sync-script`;
  if (shell === "windows") {
    return `curl.exe -fsSL "${script}" -o "$env:USERPROFILE\\oa-orca-sync.mjs"; node "$env:USERPROFILE\\oa-orca-sync.mjs" --url "${base}" --token "${token}"`;
  }
  if (shell === "unix") return `curl -fsSL "${script}" -o ~/oa-orca-sync.mjs && node ~/oa-orca-sync.mjs --url "${base}" --token "${token}"`;
  return `pnpm orca:sync-catalog --url "${base}" --token "${token}"`;
}

/** 逗号 / 空格分隔的思考强度列表 */
function splitEfforts(raw: string): string[] {
  return [...new Set(raw.split(/[\s,，、]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="min-w-0 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-medium text-ink-2">{title}</h3>
        {action}
      </div>
      {hint && <p className="-mt-1 mb-2 text-xs text-ink-3">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * 「Orca 模型目录」管理区块：目录来源与同步状态、同步密钥与一键复制的同步命令、手动导入 JSON 快照、自定义常用模型。
 * OA 部署在 NAS / 容器中时无法读取 Orca，需要运行 Orca 的电脑执行同步命令把目录推送上来。
 */
export function OrcaCatalogPanel({
  snapshots,
  customModels,
  syncKey,
  fallbackBaseUrl,
}: {
  snapshots: OrcaSnapshotRow[];
  customModels: OrcaCustomModelRow[];
  syncKey: OrcaSyncKeyRow;
  fallbackBaseUrl: string;
}) {
  const router = useRouter();
  const orca = useOrcaCatalog();
  const { run, pending } = useAction();
  // 同步命令里带上用户当前访问 OA 的地址（NAS 的局域网 IP / 域名），服务端渲染时回退 OA_PUBLIC_BASE_URL
  const base = useSyncExternalStore(noop, () => window.location.origin, () => fallbackBaseUrl);
  const [shell, setShell] = useState<Shell>("windows");
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [paste, setPaste] = useState("");
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState({ agent: "", modelId: "", label: "", efforts: "", defaultEffort: "" });

  const catalog = orca.catalog;
  const realAgents = useMemo(() => (catalog?.agents ?? []).filter((a) => a.installed || a.modelSource), [catalog]);
  const modelTotal = realAgents.reduce((n, a) => n + a.models.length, 0);
  const agentIds = useMemo(() => [...new Set((catalog?.agents ?? []).map((a) => a.id))], [catalog]);
  const draftEfforts = splitEfforts(draft.efforts);

  const refreshAll = () => {
    router.refresh();
    void loadOrcaCatalog(true);
  };

  const ensureToken = async (): Promise<string | null> => {
    if (token) return token;
    const r = await run(() => revealOrcaSyncKeyAction(), { refresh: false });
    if (!r.ok) return null;
    setToken(r.data.token);
    return r.data.token;
  };

  const masked = syncKey.prefix ? `${syncKey.prefix}…` : "<同步密钥>";
  const commandShown = syncCommand(shell, base, shown && token ? token : masked);

  const copyCommand = async () => {
    const t = await ensureToken();
    if (t) void copyWithToast(syncCommand(shell, base, t), "已复制同步命令");
  };

  const rotate = () =>
    run(() => rotateOrcaSyncKeyAction(), {
      success: syncKey.exists ? "已重置同步密钥，旧密钥已失效" : "已生成同步密钥",
      onSuccess: (r) => {
        setToken(r.token);
        setShown(true);
      },
    });

  const importSnapshot = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    try {
      JSON.parse(text);
    } catch {
      toast.error("不是合法的 JSON：请粘贴 sync-catalog.mjs --out 导出的文件内容");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/im/webhooks/orca-catalog/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
      const body = (await res.json().catch(() => null)) as { error?: string; host?: string; agentCount?: number; modelCount?: number } | null;
      if (!res.ok) {
        toast.error(body?.error ?? `导入失败（HTTP ${res.status}）`);
        return;
      }
      toast.success(`已导入 ${body?.host}：${body?.agentCount} 个基座 / ${body?.modelCount} 个模型`);
      setPaste("");
      refreshAll();
    } catch {
      toast.error("导入失败：网络错误");
    } finally {
      setImporting(false);
    }
  };

  const addModel = () =>
    run(
      () =>
        addOrcaCustomModelAction({
          agent: draft.agent,
          modelId: draft.modelId,
          label: draft.label,
          efforts: draftEfforts,
          defaultEffort: draft.defaultEffort || null,
        }),
      {
        success: `已添加 ${draft.agent.trim().toLowerCase()} / ${draft.modelId.trim()}`,
        onSuccess: () => {
          setDraft({ ...draft, modelId: "", label: "", defaultEffort: "" });
          void loadOrcaCatalog(true);
        },
      },
    );

  const grouped = useMemo(() => {
    const m = new Map<string, OrcaCustomModelRow[]>();
    for (const c of customModels) m.set(c.agent, [...(m.get(c.agent) ?? []), c]);
    return [...m.entries()];
  }, [customModels]);

  return (
    <Card className="min-w-0 space-y-3 p-4 max-md:p-3">
      <div className="flex items-start gap-3" data-testid="orca-catalog-panel">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar text-ink-2">
          <Server className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-ink">Orca 模型目录</h2>
            {catalog && (
              <Badge color={catalog.origin.kind === "local" ? "green" : catalog.origin.kind === "synced" ? "blue" : "orange"}>
                {catalog.origin.kind === "local" ? "本机 Orca" : catalog.origin.kind === "synced" ? "已同步" : "未同步"}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 break-words text-xs text-ink-3" data-testid="orca-catalog-origin">
            {catalog ? originText(catalog.origin) : orca.loading ? "正在读取 Orca 目录…" : (orca.error ?? "—")}
          </p>
          {catalog && (catalog.origin.kind !== "preset" || catalog.customModelCount > 0) && (
            <p className="mt-0.5 text-xs text-ink-2">
              {realAgents.length} 个基座 · {modelTotal} 个模型{catalog.customModelCount ? `（含 ${catalog.customModelCount} 个自定义模型）` : ""}
            </p>
          )}
          {catalog?.warnings[0] && catalog.origin.kind !== "local" && <p className="mt-1 text-xs text-amber-600">{catalog.warnings[0]}</p>}
        </div>
        <Button variant="ghost" onClick={() => void orca.refresh()} disabled={orca.loading} aria-label="刷新 Orca 目录">
          <RefreshCw className={cn("size-3.5", orca.loading && "animate-spin")} />
          <span className="max-sm:hidden">刷新</span>
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-ink-3">
        OA 与 Orca 在同一台电脑时自动读取本机目录；OA 部署在 NAS / Docker 时，在运行 Orca 的电脑上执行下方同步命令（可放进 Orca 定时自动化），
        把真实的基座、模型与思考强度推送到 OA。手动添加的自定义模型单独保存，不会被同步覆盖。
      </p>

      <Section title={`已同步主机（${snapshots.length}）`} hint={snapshots.length ? undefined : "还没有主机同步过目录。"}>
        {snapshots.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {snapshots.map((s) => (
              <li key={s.host} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">
                    {s.label ? `${s.label} ` : ""}
                    <span className="font-mono text-ink-2">{s.host}</span>
                  </div>
                  <div className="text-ink-3">
                    {s.agentCount} 个基座 · {s.modelCount} 个模型 · {formatSyncTime(s.syncedAt)}（{relativeTime(s.syncedAt)}）
                  </div>
                </div>
                <Badge>{VIA_LABEL[s.via] ?? s.via}</Badge>
                <ConfirmButton
                  variant="ghost"
                  danger
                  title={`删除主机「${s.label ?? s.host}」的目录快照`}
                  description="删除后该主机的模型不再出现在选择器中，下次执行同步命令会重新上传。"
                  confirmText="删除"
                  aria-label={`删除 ${s.host} 的快照`}
                  onConfirm={() => run(() => deleteOrcaSnapshotAction(s.host), { success: "已删除", onSuccess: () => void loadOrcaCatalog(true) })}
                >
                  <Trash2 className="size-3.5" />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="同步密钥与命令"
        hint="在运行 Orca 的 Windows / Mac 电脑上执行（需要 Node 22.5+）；同一台电脑再次执行会覆盖上一次的目录。"
        action={
          syncKey.exists ? (
            <span className="text-[11px] text-ink-3">
              {syncKey.lastUsedAt ? `上次使用 ${formatSyncTime(syncKey.lastUsedAt)}` : "尚未使用"}
            </span>
          ) : undefined
        }
      >
        {!syncKey.exists && !token ? (
          <Button variant="primary" loading={pending} onClick={rotate}>
            <KeyRound className="size-3.5" />
            生成同步密钥
          </Button>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="min-w-0 max-w-full break-all rounded border border-line bg-sidebar px-2 py-1 font-mono text-xs text-ink" data-testid="orca-sync-key">
                {shown && token ? token : masked}
              </code>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (shown) setShown(false);
                  else if (await ensureToken()) setShown(true);
                }}
              >
                {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {shown ? "隐藏" : "查看"}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const t = await ensureToken();
                  if (t) void copyWithToast(t, "已复制同步密钥");
                }}
              >
                <Copy className="size-3.5" />
                复制密钥
              </Button>
              <ConfirmButton
                variant="ghost"
                title="重置 Orca 目录同步密钥"
                description="旧密钥立即失效，已配置的同步命令 / 定时自动化需要换用新密钥。"
                confirmText="重置"
                onConfirm={rotate}
              >
                <KeyRound className="size-3.5" />
                重置
              </ConfirmButton>
            </div>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="命令类型">
              {SHELLS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={shell === s.key}
                  onClick={() => setShell(s.key)}
                  className={cn(
                    "h-6 rounded px-2 text-xs transition-colors",
                    shell === s.key ? "bg-accent-soft text-accent-hover" : "text-ink-2 hover:bg-hover hover:text-ink",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <pre
                className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-sidebar px-2.5 py-2 pr-20 font-mono text-xs leading-relaxed text-ink"
                data-testid="orca-sync-command"
              >
                {commandShown}
              </pre>
              <Button variant="default" className="absolute right-1.5 top-1.5" onClick={() => void copyCommand()}>
                <Copy className="size-3.5" />
                复制
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              定时自动同步：在 Orca 中新建定时自动化（例如每 30 分钟或每天开机后），让它执行上面这条命令即可；
              也可以加 <code>--label 办公室电脑</code> 标注主机，或加 <code>--dry-run</code> 先预览。详见仓库 <code>docs/orca-catalog-sync.md</code>。
            </p>
          </div>
        )}
      </Section>

      <Section title="手动导入快照" hint="无法直连 OA 时，在 Orca 电脑上执行 sync-catalog.mjs --out orca-catalog.json 导出，再在这里上传或粘贴。">
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={paste}
            placeholder='{"version":1,"source":{"host":"…"},"agents":[…]}'
            className="font-mono text-xs"
            onChange={(e) => setPaste(e.target.value)}
            aria-label="粘贴 Orca 目录快照 JSON"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={importing} disabled={!paste.trim()} onClick={() => void importSnapshot(paste)}>
              导入粘贴的 JSON
            </Button>
            <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-ink-2 ring-1 ring-inset ring-line hover:bg-hover">
              <FileUp className="size-3.5" />
              选择 JSON 文件
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 1024 * 1024) {
                    toast.error("文件超过 1 MB 上限");
                    return;
                  }
                  await importSnapshot(await file.text());
                }}
              />
            </label>
          </div>
        </div>
      </Section>

      <Section title={`自定义常用模型（${customModels.length}）`} hint="按基座补充同步目录中没有的模型（如新上线的模型）；单独保存，Push 同步不会覆盖或删除。">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Field label="基座" required className="min-w-0">
            <Input
              value={draft.agent}
              list="orca-agent-ids"
              maxLength={40}
              placeholder="如 claude"
              className="font-mono"
              onChange={(e) => setDraft({ ...draft, agent: e.target.value })}
            />
            <datalist id="orca-agent-ids">
              {agentIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </Field>
          <Field label="模型 ID" required className="min-w-0">
            <Input value={draft.modelId} maxLength={120} placeholder="如 claude-opus-6" className="font-mono" onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} />
          </Field>
          <Field label="显示名称" className="min-w-0">
            <Input value={draft.label} maxLength={80} placeholder="可选" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
          <Field label="思考强度" className="min-w-0">
            <Input value={draft.efforts} maxLength={200} placeholder="low medium high" className="font-mono" onChange={(e) => setDraft({ ...draft, efforts: e.target.value })} />
          </Field>
          <Field label="默认强度" className="min-w-0">
            <Select value={draft.defaultEffort} onChange={(e) => setDraft({ ...draft, defaultEffort: e.target.value })} disabled={!draftEfforts.length}>
              <option value="">未指定</option>
              {draftEfforts.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-2">
          <Button variant="primary" loading={pending} disabled={!draft.agent.trim() || !draft.modelId.trim()} onClick={addModel}>
            <Plus className="size-3.5" />
            添加模型
          </Button>
        </div>
        {grouped.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="orca-custom-models">
            {grouped.map(([agent, models]) => (
              <li key={agent} className="rounded-md border border-line">
                <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-xs font-medium text-ink-2">
                  <AgentIcon agent={agent} size={14} />
                  <span className="font-mono">{agent}</span>
                </div>
                <ul className="divide-y divide-line">
                  {models.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-xs">
                      <span className="min-w-0 break-all font-mono text-ink">{m.modelId}</span>
                      {m.label && <span className="text-ink-3">{m.label}</span>}
                      <span className="flex flex-wrap gap-1">
                        {m.efforts.map((e) => (
                          <Badge key={e} color={e === m.defaultEffort ? "blue" : "gray"}>
                            {e}
                          </Badge>
                        ))}
                      </span>
                      <span className="flex-1" />
                      <Button
                        variant="ghost"
                        aria-label={`删除 ${agent} / ${m.modelId}`}
                        onClick={() => run(() => removeOrcaCustomModelAction(m.id), { success: "已删除", onSuccess: () => void loadOrcaCatalog(true) })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Card>
  );
}
