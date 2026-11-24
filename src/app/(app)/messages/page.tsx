import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { getOrCreateDirect } from "@/lib/im/service";
import { EmptyState } from "@/components/ui/page";

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const { to } = await searchParams;
  const user = await requireUser();
  if (typeof to === "string" && to && to !== user.id) {
    // 目标成员存在且未停用时直达单聊；否则回落到空态
    const target = await db.user.findFirst({ where: { id: to, active: true }, select: { id: true } });
    if (target) {
      const conv = await db.$transaction((tx) => getOrCreateDirect(tx, user.id, to));
      redirect(`/messages/${conv.id}`);
    }
  }
  return (
    <div className="flex min-h-app items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState icon={<MessageCircle />} title="选择一个会话开始聊天" description="从左侧列表选择会话，或在通讯录中向同事发起新会话。" />
      </div>
    </div>
  );
}
