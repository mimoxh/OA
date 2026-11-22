"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Search, Send, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAction } from "@/components/ui/use-action";
import { BIZ_META, REF_LABEL } from "@/lib/im/biz-meta";
import type { ConversationDTO, RefType } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { shareRefToChat } from "@/app/(app)/messages/actions";
import { ConvAvatar } from "./conversation-list";

type ShareUser = { id: string; name: string; avatarColor: string; title: string | null; department: string | null };
type Target = { kind: "conv"; id: string; label: string } | { kind: "user"; id: string; label: string };

export function ShareToChatButton({
  refType,
  refId,
  title,
  subtitle,
  variant = "button",
}: {
  refType: RefType;
  refId: string;
  title: string;
  subtitle?: string | null;
  variant?: "button" | "icon";
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [convs, setConvs] = useState<ConversationDTO[]>([]);
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Target | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/im/share-targets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { conversations: ConversationDTO[]; users: ShareUser[] }) => {
        if (cancelled) return;
        setConvs(d.conversations ?? []);
        setUsers(d.users ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error("加载会话列表失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const directPeerIds = useMemo(() => new Set(convs.filter((c) => c.type === "DIRECT" && c.peerId).map((c) => c.peerId!)), [convs]);

  const filteredConvs = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return convs;
    return convs.filter((c) => c.name.toLowerCase().includes(k));
  }, [convs, q]);

  const filteredUsers = useMemo(() => {
    const k = q.trim().toLowerCase();
    // 已有单聊的成员在会话列表里已经展示；搜索时也一并列出便于查找
    const base = k ? users : users.filter((u) => !directPeerIds.has(u.id));
    if (!k) return base;
    return base.filter(
      (u) =>
        u.name.toLowerCase().includes(k) ||
        (u.title ?? "").toLowerCase().includes(k) ||
        (u.department ?? "").toLowerCase().includes(k),
    );
  }, [users, directPeerIds, q]);

  const close = () => {
    setOpen(false);
    setQ("");
    setSelected(null);
    setNote("");
  };

  const submit = () => {
    if (!selected) return;
    run(
      () =>
        shareRefToChat({
          conversationId: selected.kind === "conv" ? selected.id : undefined,
          targetUserId: selected.kind === "user" ? selected.id : undefined,
          refType,
          refId,
          note: note.trim() || undefined,
        }),
      {
        refresh: false,
        onSuccess: (res) => {
          const targetLabel = selected.label;
          close();
          toast.success(`已分享到「${targetLabel}」`, {
            action: {
              label: "查看会话",
              onClick: () => router.push(`/messages/${res.conversationId}`),
            },
          });
        },
      },
    );
  };

  const openDialog = () => {
    setLoading(true);
    setOpen(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <IconButton title="分享到会话" onClick={openDialog}>
          <Share2 className="size-4" />
        </IconButton>
      ) : (
        <Button size="sm" onClick={openDialog}>
          <Share2 className="size-3.5" />
          分享到会话
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent
          size="md"
          title="分享到会话"
          footer={
            <>
              <Button onClick={close}>取消</Button>
              <Button variant="primary" loading={pending} disabled={!selected} onClick={submit}>
                <Send className="size-3.5" />
                发送
              </Button>
            </>
          }
        >
          <div className="space-y-3 pb-1">
            {/* 分享对象预览 */}
            <div className="rounded-md border border-line bg-sidebar px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-tag-blue px-1.5 py-0.5 text-[10px] font-medium text-tag-blue-ink">
                  {REF_LABEL[refType]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{title}</span>
              </div>
              {subtitle && <div className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</div>}
            </div>

            {/* 搜索会话/同事 */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索会话、群聊或同事…"
                className="h-8 w-full rounded-md border border-line-strong bg-white pl-8 pr-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </div>

            {/* 目标列表 */}
            <div className="max-h-60 overflow-y-auto rounded-md border border-line">
              {loading ? (
                <div className="py-8 text-center text-xs text-ink-3">加载中…</div>
              ) : !filteredConvs.length && !filteredUsers.length ? (
                <div className="py-8 text-center text-xs text-ink-3">没有匹配的会话或同事</div>
              ) : (
                <div className="divide-y divide-line/60">
                  {filteredConvs.length > 0 && (
                    <div className="p-1">
                      <div className="px-2 py-1 text-[11px] font-medium text-ink-3">最近会话</div>
                      {filteredConvs.map((c) => {
                        const active = selected?.kind === "conv" && selected.id === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelected({ kind: "conv", id: c.id, label: c.name })}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                              active ? "bg-accent-soft" : "hover:bg-hover",
                            )}
                          >
                            <ConvAvatar conv={c} size={28} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-ink">{c.name}</span>
                                {c.bizType && (
                                  <span className="shrink-0 rounded bg-tag-blue px-1 py-px text-[10px] text-tag-blue-ink">
                                    {BIZ_META[c.bizType].tag}
                                  </span>
                                )}
                              </span>
                              <span className="block text-[11px] text-ink-3">
                                {c.type === "GROUP" ? `${c.memberCount} 人群聊` : "单聊"}
                              </span>
                            </span>
                            {active && <Check className="size-4 shrink-0 text-accent" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {filteredUsers.length > 0 && (
                    <div className="p-1">
                      <div className="px-2 py-1 text-[11px] font-medium text-ink-3">同事</div>
                      {filteredUsers.map((u) => {
                        const active = selected?.kind === "user" && selected.id === u.id;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setSelected({ kind: "user", id: u.id, label: u.name })}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                              active ? "bg-accent-soft" : "hover:bg-hover",
                            )}
                          >
                            <Avatar name={u.name} color={u.avatarColor} size={28} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-ink">{u.name}</span>
                              {(u.department || u.title) && (
                                <span className="block truncate text-[11px] text-ink-3">
                                  {[u.department, u.title].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </span>
                            {active && <Check className="size-4 shrink-0 text-accent" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 附言 */}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="给对方留句话（可选）…"
              className="w-full resize-none rounded-md border border-line-strong px-2.5 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
