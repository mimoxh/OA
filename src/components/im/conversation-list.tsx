"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  ClipboardCheck,
  Ellipsis,
  FileText,
  FolderKanban,
  MessageCirclePlus,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { MemberMultiSelect, MemberSelect } from "@/components/oa/member-picker";
import type { MemberOption } from "@/lib/oa/types";
import type { BotKey } from "@/lib/im/bots";
import type { ConversationDTO } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ui/use-action";
import { createGroupChat, openDirect, updateConversationPrefs } from "@/app/(app)/messages/actions";
import { useConversations, useOnline } from "./store";
import { convTime } from "./time";

const BOT_ICONS: Record<BotKey, ReactNode> = {
  approval: <ClipboardCheck className="size-4 text-white" />,
  project: <FolderKanban className="size-4 text-white" />,
  docs: <FileText className="size-4 text-white" />,
  system: <Bell className="size-4 text-white" />,
};

/** 会话头像：单聊圆形头像 + 在线点；群聊/机器人为彩色圆角块 */
export function ConvAvatar({ conv, size = 36, showPresence }: { conv: ConversationDTO; size?: number; showPresence?: boolean }) {
  const online = useOnline(conv.peerId);
  if (conv.type === "DIRECT") {
    return (
      <span className="relative shrink-0">
        <Avatar name={conv.name} color={conv.avatarColor} size={size} />
        {showPresence && online && (
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-sidebar bg-green-500" />
        )}
      </span>
    );
  }
  const radius = "rounded-lg";
  if (conv.type === "BOT") {
    const key = (conv.botKey ?? "system") as BotKey;
    return (
      <span className={cn("flex shrink-0 items-center justify-center text-white", radius)} style={{ width: size, height: size, backgroundColor: conv.avatarColor }}>
        {BOT_ICONS[key] ?? BOT_ICONS.system}
      </span>
    );
  }
  return (
    <span
      className={cn("flex shrink-0 select-none items-center justify-center font-medium text-white", radius)}
      style={{ width: size, height: size, backgroundColor: conv.avatarColor, fontSize: size * 0.4 }}
    >
      {(conv.name ?? "群").trim().charAt(0)}
    </span>
  );
}

function previewText(conv: ConversationDTO): string {
  const lm = conv.lastMessage;
  if (!lm) return "暂无消息";
  if (lm.recalled) return `${lm.senderName ?? ""} 撤回了一条消息`;
  if (lm.type === "CARD") return `[卡片] ${lm.text}`;
  const body = lm.text.replace(/\n/g, " ");
  if (conv.type === "GROUP" && lm.senderName) return `${lm.senderName}：${body}`;
  return body;
}

function RowMenu({ conv }: { conv: ConversationDTO }) {
  const { run } = useAction();
  const set = (patch: { pinned?: boolean; muted?: boolean; hidden?: boolean }) =>
    run(() => updateConversationPrefs({ conversationId: conv.id, ...patch }), { refresh: false });
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          className="absolute right-1.5 top-1.5 hidden rounded p-0.5 text-ink-3 hover:bg-active hover:text-ink group-hover/row:block"
          aria-label="会话操作"
          onClick={(e) => e.preventDefault()}
        >
          <Ellipsis className="size-4" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={conv.pinned ? <PinOff /> : <Pin />} onSelect={() => set({ pinned: !conv.pinned })}>
          {conv.pinned ? "取消置顶" : "置顶"}
        </MenuItem>
        <MenuItem icon={<BellOff />} onSelect={() => set({ muted: !conv.muted })}>
          {conv.muted ? "取消免打扰" : "免打扰"}
        </MenuItem>
        <MenuItem icon={<Trash2 />} onSelect={() => set({ hidden: true })}>
          从列表移除
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function ConversationList() {
  const { list, loaded } = useConversations();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return list;
    return list.filter((c) => c.name.toLowerCase().includes(k));
  }, [list, q]);

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="relative px-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索会话"
          className="h-8 w-full rounded-md border border-line-strong bg-white pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </div>
      {loaded && !list.length && <div className="px-2 py-10 text-center text-[13px] text-ink-3">暂无会话</div>}
      {filtered.map((conv) => {
        const active = pathname === `/messages/${conv.id}`;
        return (
          <div key={conv.id} className="group/row relative">
            <Link
              href={`/messages/${conv.id}`}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors",
                active ? "bg-active" : "hover:bg-hover",
                conv.pinned && !active && "bg-hover/60",
              )}
            >
              <ConvAvatar conv={conv} showPresence />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink">{conv.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{convTime(conv.lastMessageAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{previewText(conv)}</span>
                  {conv.muted && <BellOff className="size-3 shrink-0 text-ink-3" />}
                  {conv.unread > 0 && (
                    <span
                      className={cn(
                        "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none text-white",
                        conv.muted ? "bg-ink-3" : "bg-danger",
                      )}
                    >
                      {conv.unread > 99 ? "99+" : conv.unread}
                    </span>
                  )}
                </span>
              </span>
            </Link>
            <RowMenu conv={conv} />
          </div>
        );
      })}
      {loaded && q && !filtered.length && <div className="px-2 py-6 text-center text-[13px] text-ink-3">没有匹配的会话</div>}
    </div>
  );
}

/** 面板头部「+」菜单：发起单聊 / 发起群聊 */
export function NewChatMenu({ members, meId }: { members: MemberOption[]; meId: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [dialog, setDialog] = useState<"direct" | "group" | null>(null);
  const [directId, setDirectId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const others = useMemo(() => members.filter((m) => m.id !== meId), [members, meId]);

  const close = () => {
    setDialog(null);
    setDirectId(null);
    setGroupName("");
    setGroupIds([]);
  };
  const submitDirect = () =>
    directId &&
    run(() => openDirect(directId), {
      refresh: false,
      onSuccess: (d) => {
        close();
        router.push(`/messages/${d.conversationId}`);
      },
    });
  const submitGroup = () =>
    groupIds.length > 0 &&
    run(() => createGroupChat({ name: groupName || undefined, memberIds: groupIds }), {
      refresh: false,
      onSuccess: (d) => {
        close();
        router.push(`/messages/${d.conversationId}`);
      },
    });

  const btnCls =
    "h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50";

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button className="rounded-md p-1 text-ink-2 hover:bg-hover" aria-label="发起会话">
            <Plus className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<MessageCirclePlus />} onSelect={() => setDialog("direct")}>
            发起单聊
          </MenuItem>
          <MenuItem icon={<Users />} onSelect={() => setDialog("group")}>
            发起群聊
          </MenuItem>
        </MenuContent>
      </Menu>

      <Dialog open={dialog === "direct"} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title="发起单聊"
          footer={
            <button onClick={submitDirect} disabled={!directId || pending} className={btnCls}>
              开始聊天
            </button>
          }
        >
          <MemberSelect members={others} value={directId} onChange={setDirectId} placeholder="选择成员" />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "group"} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title="发起群聊"
          footer={
            <button onClick={submitGroup} disabled={!groupIds.length || pending} className={btnCls}>
              创建群聊
            </button>
          }
        >
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-[13px] text-ink-2">群名称（可选）</div>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                maxLength={40}
                placeholder="未命名时按成员自动生成"
                className="h-8 w-full rounded-md border border-line-strong px-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <div className="mb-1 text-[13px] text-ink-2">选择成员</div>
              <MemberMultiSelect members={others} value={groupIds} onChange={setGroupIds} addLabel="添加成员" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
