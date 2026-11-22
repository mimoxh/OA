"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BellOff, Check, DoorOpen, Ellipsis, Pencil, Pin, PinOff, UserPlus, UserRound, Users, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { MemberMultiSelect } from "@/components/oa/member-picker";
import type { MemberOption } from "@/lib/oa/types";
import type { ConversationDTO, MessageDTO, UserLite } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ui/use-action";
import {
  addChatMembers,
  leaveChat,
  removeChatMember,
  renameGroupChat,
  transferChatOwner,
  updateConversationPrefs,
} from "@/app/(app)/messages/actions";
import {
  loadMembers,
  seedConversation,
  seedMembers,
  useConversation,
  useGroupMembers,
  useOnline,
  type GroupMember,
} from "./store";
import { ConvAvatar } from "./conversation-list";
import { MessageList } from "./message-list";
import { Composer } from "./composer";

type Me = UserLite;

export function ChatView({
  initialConversation,
  initialMembers,
  me,
  peerTitle,
  memberOptions,
}: {
  initialConversation: ConversationDTO;
  initialMembers: GroupMember[] | null;
  me: Me;
  peerTitle: string | null;
  memberOptions: MemberOption[];
}) {
  const router = useRouter();
  const convId = initialConversation.id;

  useEffect(() => {
    seedConversation(initialConversation);
    if (initialMembers) seedMembers(convId, initialMembers);
    if (initialConversation.type === "GROUP") void loadMembers(convId);
  }, [convId, initialConversation, initialMembers]);

  // 被移出/群解散 → 回列表
  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent<string>).detail === convId) router.push("/messages");
    };
    window.addEventListener("im:conversation-removed", h);
    return () => window.removeEventListener("im:conversation-removed", h);
  }, [convId, router]);

  const conv = useConversation(convId) ?? initialConversation;
  const online = useOnline(conv.peerId);
  const [drawer, setDrawer] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);
  const { run } = useAction();

  const subtitle =
    conv.type === "DIRECT"
      ? [online ? "在线" : "离线", peerTitle].filter(Boolean).join(" · ")
      : conv.type === "GROUP"
        ? `${conv.memberCount} 人`
        : "机器人";

  const set = (patch: { pinned?: boolean; muted?: boolean }) =>
    run(() => updateConversationPrefs({ conversationId: convId, ...patch }), { refresh: false });

  return (
    <div className="flex h-screen">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 会话头 */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <ConvAvatar conv={conv} size={36} showPresence />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-ink">{conv.name}</div>
            <div className="truncate text-xs text-ink-3">{subtitle}</div>
          </div>
          {conv.type === "GROUP" && (
            <button
              onClick={() => setDrawer((v) => !v)}
              className={cn("rounded-md p-2", drawer ? "bg-active text-accent" : "text-ink-2 hover:bg-hover")}
              aria-label="群设置"
            >
              <Users className="size-4.5" />
            </button>
          )}
          <Menu>
            <MenuTrigger asChild>
              <button className="rounded-md p-2 text-ink-2 hover:bg-hover" aria-label="会话设置">
                <Ellipsis className="size-4.5" />
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={conv.pinned ? <PinOff /> : <Pin />} onSelect={() => set({ pinned: !conv.pinned })}>
                {conv.pinned ? "取消置顶" : "置顶会话"}
              </MenuItem>
              <MenuItem icon={<BellOff />} onSelect={() => set({ muted: !conv.muted })}>
                {conv.muted ? "取消免打扰" : "免打扰"}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>

        <MessageList conv={conv} me={me} onReply={setReplyTo} />
        {conv.type === "BOT" ? (
          <div className="shrink-0 border-t border-line bg-sidebar px-4 py-3 text-center text-[13px] text-ink-3">
            机器人会话不支持回复
          </div>
        ) : (
          <Composer conv={conv} me={me} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
        )}
      </div>

      {drawer && conv.type === "GROUP" && (
        <GroupSettings conv={conv} me={me} memberOptions={memberOptions} onClose={() => setDrawer(false)} />
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { OWNER: "群主", ADMIN: "管理员" };

function GroupSettings({
  conv,
  me,
  memberOptions,
  onClose,
}: {
  conv: ConversationDTO;
  me: Me;
  memberOptions: MemberOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const members = useGroupMembers(conv.id);
  const { run, pending } = useAction();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(conv.name);
  const [adding, setAdding] = useState(false);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const myRole = members?.find((m) => m.id === me.id)?.role ?? conv.role;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const memberIds = useMemo(() => (members ?? []).map((m) => m.id), [members]);

  const submitRename = () => {
    const v = name.trim();
    setRenaming(false);
    if (v && v !== conv.name) run(() => renameGroupChat({ conversationId: conv.id, name: v }), { refresh: false });
  };
  const submitAdd = () => {
    if (!addIds.length) return;
    run(() => addChatMembers({ conversationId: conv.id, memberIds: addIds }), {
      refresh: false,
      onSuccess: () => setAddIds([]),
    });
  };

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-line bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="text-[15px] font-semibold text-ink">群设置</div>
        <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="关闭">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* 群名称 */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-ink-3">群名称</span>
          {!renaming && (
            <button onClick={() => { setName(conv.name); setRenaming(true); }} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="重命名">
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
        {renaming ? (
          <div className="mb-4 flex items-center gap-1.5">
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRename()}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong px-2 text-sm focus:border-accent focus:outline-none"
            />
            <button onClick={submitRename} className="rounded p-1.5 text-accent hover:bg-hover" aria-label="确定">
              <Check className="size-4" />
            </button>
          </div>
        ) : (
          <div className="mb-4 truncate text-sm text-ink">{conv.name}</div>
        )}

        {/* 成员 */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-ink-3">成员（{members?.length ?? 0}）</span>
        </div>
        {adding && (
          <div className="mb-2 rounded-md border border-line bg-white p-2">
            <MemberMultiSelect members={memberOptions} value={addIds} onChange={setAddIds} exclude={memberIds} addLabel="选择成员" />
            <div className="mt-2 flex justify-end gap-1.5">
              <button onClick={() => { setAdding(false); setAddIds([]); }} className="rounded px-2 py-1 text-xs text-ink-2 hover:bg-hover">
                取消
              </button>
              <button onClick={submitAdd} disabled={!addIds.length || pending} className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
                添加
              </button>
            </div>
          </div>
        )}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] text-ink-2 hover:bg-hover"
          >
            <UserPlus className="size-4" />
            添加成员
          </button>
        )}
        <div className="flex flex-col">
          {(members ?? []).map((m) => {
            const isMe = m.id === me.id;
            const removable = canManage && !isMe && m.role !== "OWNER";
            return (
              <div key={m.id} className="group/member flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-hover">
                <Avatar name={m.name} color={m.avatarColor} size={28} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {m.name}
                  {isMe && <span className="text-ink-3">（我）</span>}
                </span>
                {ROLE_LABEL[m.role] && (
                  <span className="shrink-0 rounded bg-tag-blue px-1.5 py-0.5 text-[10px] text-tag-blue-ink">{ROLE_LABEL[m.role]}</span>
                )}
                {removable && (
                  <Menu>
                    <MenuTrigger asChild>
                      <button className="hidden shrink-0 rounded p-1 text-ink-3 hover:bg-active hover:text-ink group-hover/member:block" aria-label="成员操作">
                        <Ellipsis className="size-3.5" />
                      </button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      {myRole === "OWNER" && (
                        <MenuItem icon={<UserRound />} onSelect={() => run(() => transferChatOwner({ conversationId: conv.id, userId: m.id }), { refresh: false })}>
                          转让群主
                        </MenuItem>
                      )}
                      <MenuItem icon={<X />} onSelect={() => run(() => removeChatMember({ conversationId: conv.id, userId: m.id }), { refresh: false })}>
                        移出群聊
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-line p-3">
        <button
          onClick={() => setConfirmLeave(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[13px] text-danger hover:bg-tag-red"
        >
          <DoorOpen className="size-4" />
          退出群聊
        </button>
      </div>
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent
          title="退出群聊"
          description={`确定退出「${conv.name}」吗？`}
          footer={
            <>
              <button onClick={() => setConfirmLeave(false)} className="h-8 rounded-md px-3 text-[13px] text-ink-2 hover:bg-hover">
                取消
              </button>
              <button
                onClick={() =>
                  run(() => leaveChat(conv.id), {
                    refresh: false,
                    onSuccess: () => router.push("/messages"),
                  })
                }
                disabled={pending}
                className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white disabled:opacity-50"
              >
                退出群聊
              </button>
            </>
          }
        />
      </Dialog>
    </aside>
  );
}
