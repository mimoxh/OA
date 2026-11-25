import { requireUser } from "@/lib/auth/dal";
import { getMemberOptions } from "@/lib/oa/server";
import { ContextPanel } from "@/components/shell/context-panel";
import { ConversationList, NewChatMenu } from "@/components/im/conversation-list";
import { MessagesShell } from "@/components/im/messages-shell";

export default async function MessagesLayout({ children }: LayoutProps<"/messages">) {
  const user = await requireUser();
  const members = await getMemberOptions({ includeBots: true });
  return (
    <MessagesShell
      panel={
        <ContextPanel title="消息" actions={<NewChatMenu members={members} meId={user.id} />}>
          <ConversationList />
        </ContextPanel>
      }
    >
      {children}
    </MessagesShell>
  );
}
