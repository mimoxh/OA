import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { getConversation } from "@/lib/im/queries";
import { getMemberOptions } from "@/lib/oa/server";
import { ChatView } from "@/components/im/chat-view";

export default async function ChatPage({ params, searchParams }: PageProps<"/messages/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawSeq = Number(typeof sp.seq === "string" ? sp.seq : "");
  const initialFocusSeq = Number.isInteger(rawSeq) && rawSeq > 0 ? rawSeq : null;
  const initialThreadRootId = typeof sp.thread === "string" && sp.thread.trim() ? sp.thread.trim() : null;
  const user = await requireUser();
  const res = await getConversation(user.id, id);
  if (!res) notFound();
  const memberOptions = await getMemberOptions();
  const peer = res.conversation.peerId ? memberOptions.find((m) => m.id === res.conversation.peerId) : null;
  return (
    <ChatView
      key={res.conversation.id}
      initialConversation={res.conversation}
      initialMembers={res.members}
      initialFocusSeq={initialFocusSeq}
      initialThreadRootId={initialThreadRootId}
      me={{ id: user.id, name: user.name, avatarColor: user.avatarColor }}
      peerTitle={peer?.title ?? null}
      memberOptions={memberOptions}
    />
  );
}
