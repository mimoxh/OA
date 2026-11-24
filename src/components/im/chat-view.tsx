"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BellOff,
  Check,
  DoorOpen,
  Ellipsis,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Search,
  UserPlus,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { MemberMultiSelect } from "@/components/oa/member-picker";
import type { MemberOption } from "@/lib/oa/types";
import { BIZ_META } from "@/lib/im/biz-meta";
import type { ConversationDTO, MessageDTO, MessageSearchHit, UserLite } from "@/lib/im/types";
import type { ChatRunConfigContext } from "@/lib/im/webhook-run-config";
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
  setActiveConversation,
  useConversation,
  useGroupMembers,
  useOnline,
  type GroupMember,
} from "./store";
import {
  setCallMinimized,
  startOrJoinConversationCall,
  useCallStore,
  useConversationActiveCall,
} from "@/components/call/store";
import { ConvAvatar } from "./conversation-list";
import { MessageList } from "./message-list";
import { Composer } from "./composer";
import { ThreadDrawer } from "./thread-drawer";
import { SearchDrawer } from "./search-drawer";
import { WebhookRunConfigBar } from "./webhook-run-config-bar";

type Me = UserLite;
type RightPanel = null | { kind: "settings" } | { kind: "search" } | { kind: "thread"; rootId: string };

export function ChatView({
  initialConversation,
  initialMembers,
  me,
  peerTitle,
  memberOptions,
  initialFocusSeq = null,
  initialThreadRootId = null,
  runConfig = null,
}: {
  initialConversation: ConversationDTO;
  initialMembers: GroupMember[] | null;
  me: Me;
  peerTitle: string | null;
  memberOptions: MemberOption[];
  initialFocusSeq?: number | null;
  initialThreadRootId?: string | null;
  /** 会话内有已启用的 Webhook 机器人时由服务端提供，否则为 null（不显示选择器） */
  runConfig?: ChatRunConfigContext | null;
}) {
  const router = useRouter();
  const convId = initialConversation.id;

  useEffect(() => {
    seedConversation(initialConversation);
    if (initialMembers) seedMembers(convId, initialMembers);
    if (initialConversation.type === "GROUP") void loadMembers(convId);
  }, [convId, initialConversation, initialMembers]);

  useEffect(() => {
    setActiveConversation(convId);
    return () => setActiveConversation(null);
  }, [convId]);

  // 被移出/群解散 → 回列表
  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent<string>).detail === convId) router.push("/messages");
    };
    window.addEventListener("im:conversation-removed", h);
    return () => window.removeEventListener("im:conversation-removed", h);
  }, [convId, router]);

  const conv = useConversation(convId) ?? initialConversation;
  const liveMembers = useGroupMembers(convId);
  const runBots = useMemo(() => {
    if (!runConfig) return [];
    // 群成员实时变化（机器人被移出）时同步隐藏
    if (conv.type === "GROUP" && liveMembers) return runConfig.bots.filter((b) => liveMembers.some((m) => m.id === b.botUserId));
    return runConfig.bots;
  }, [runConfig, conv.type, liveMembers]);
  const online = useOnline(conv.peerId);
  const activeCallEntry = useConversationActiveCall(convId);
  const { active: myActiveCall } = useCallStore();
  const [panel, setPanel] = useState<RightPanel>(() =>
    initialThreadRootId ? { kind: "thread", rootId: initialThreadRootId } : null,
  );
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);
  const [jumpSeq, setJumpSeq] = useState<number | null>(null);
  const [consumedInitial, setConsumedInitial] = useState<number | null>(null);
  const { run } = useAction();

  const focusSeq = jumpSeq ?? (initialFocusSeq != null && initialFocusSeq !== consumedInitial ? initialFocusSeq : null);

  const clearFocusSeq = useCallback(() => {
    setJumpSeq(null);
    if (initialFocusSeq != null) setConsumedInitial(initialFocusSeq);
  }, [initialFocusSeq]);

  const handleOpenThread = useCallback((msg: MessageDTO) => {
    setPanel({ kind: "thread", rootId: msg.id });
  }, []);

  const handleSelectSearchHit = useCallback((hit: MessageSearchHit) => {
    if (hit.threadRootId) {
      setPanel({ kind: "thread", rootId: hit.threadRootId });
    } else {
      setJumpSeq(hit.seq);
    }
  }, []);

  const subtitle =
    conv.type === "DIRECT"
      ? conv.peerIsBot
        ? ["Webhook 机器人", peerTitle && peerTitle !== "Webhook 机器人" ? peerTitle : null].filter(Boolean).join(" · ")
        : [online ? "在线" : "离线", peerTitle].filter(Boolean).join(" · ")
      : conv.type === "GROUP"
        ? [conv.bizType ? BIZ_META[conv.bizType].groupLabel : null, `${conv.memberCount} 人`].filter(Boolean).join(" · ")
        : "机器人";

  const set = (patch: { pinned?: boolean; muted?: boolean }) =>
    run(() => updateConversationPrefs({ conversationId: convId, ...patch }), { refresh: false });

  const inThisCall = myActiveCall?.call.conversationId === convId;

  return (
    <div className="flex h-screen">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 会话头 */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <ConvAvatar conv={conv} size={36} showPresence={!conv.peerIsBot} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="truncate text-[15px] font-semibold text-ink">{conv.name}</div>
              {conv.peerIsBot && (
                <span className="shrink-0 rounded bg-tag-purple px-1.5 py-0.5 text-[10px] font-medium text-tag-purple-ink">机器人</span>
              )}
              {conv.bizType && (
                <span className="shrink-0 rounded bg-tag-blue px-1.5 py-0.5 text-[10px] font-medium text-tag-blue-ink">
                  {BIZ_META[conv.bizType].tag}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-ink-3">{subtitle}</div>
          </div>
          {conv.bizHref && conv.bizLabel && (
            <Link
              href={conv.bizHref}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-white px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              {conv.bizLabel}
              <ArrowUpRight className="size-3.5" />
            </Link>
          )}
          {conv.type !== "BOT" && !conv.peerIsBot && (
            <>
              <button
                type="button"
                onClick={() => void startOrJoinConversationCall(convId, "audio")}
                className="rounded-md p-2 text-ink-2 hover:bg-hover"
                aria-label="语音通话"
                title={conv.type === "GROUP" ? "发起语音会议" : "语音通话"}
              >
                <Phone className="size-4.5" />
              </button>
              <button
                type="button"
                onClick={() => void startOrJoinConversationCall(convId, "video")}
                className="rounded-md p-2 text-ink-2 hover:bg-hover"
                aria-label="视频通话"
                title={conv.type === "GROUP" ? "发起视频会议" : "视频通话"}
              >
                <Video className="size-4.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setPanel((p) => (p?.kind === "search" ? null : { kind: "search" }))}
            className={cn("rounded-md p-2", panel?.kind === "search" ? "bg-active text-accent" : "text-ink-2 hover:bg-hover")}
            aria-label="查找聊天记录"
            title="查找聊天记录"
          >
            <Search className="size-4.5" />
          </button>
          {conv.type === "GROUP" && (
            <button
              onClick={() => setPanel((p) => (p?.kind === "settings" ? null : { kind: "settings" }))}
              className={cn("rounded-md p-2", panel?.kind === "settings" ? "bg-active text-accent" : "text-ink-2 hover:bg-hover")}
              aria-label="群设置"
              title="群设置"
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

        {/* 进行中的通话横幅 */}
        {activeCallEntry && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900">
            <div className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="font-medium">
                {activeCallEntry.call.kind === "audio" ? "语音" : "视频"}
                {conv.type === "GROUP" ? "会议" : "通话"}进行中
              </span>
              {activeCallEntry.peerCount != null && activeCallEntry.peerCount > 0 && (
                <span className="text-emerald-700">· {activeCallEntry.peerCount} 人在房间</span>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                inThisCall
                  ? setCallMinimized(false)
                  : void startOrJoinConversationCall(convId, activeCallEntry.call.kind)
              }
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              {inThisCall ? "回到通话" : "点击加入"}
            </button>
          </div>
        )}

        <MessageList
          conv={conv}
          me={me}
          onReply={setReplyTo}
          onOpenThread={handleOpenThread}
          focusSeq={focusSeq}
          onClearFocusSeq={clearFocusSeq}
        />
        {conv.type === "BOT" ? (
          <div className="shrink-0 border-t border-line bg-sidebar px-4 py-3 text-center text-[13px] text-ink-3">
            机器人会话不支持回复
          </div>
        ) : (
          <>
            {runConfig && runBots.length > 0 && (
              <WebhookRunConfigBar conversationId={convId} bots={runBots} initialOverride={runConfig.override} />
            )}
            <Composer conv={conv} me={me} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
          </>
        )}
      </div>

      {panel?.kind === "settings" && conv.type === "GROUP" && (
        <GroupSettings conv={conv} me={me} memberOptions={memberOptions} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === "search" && (
        <SearchDrawer conv={conv} onSelectHit={handleSelectSearchHit} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === "thread" && (
        <ThreadDrawer conv={conv} me={me} rootId={panel.rootId} onClose={() => setPanel(null)} />
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
