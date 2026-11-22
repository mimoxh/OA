import "dotenv/config";
import { db } from "@/lib/db";
import { botForNotifyType } from "@/lib/im/bots";
import { buildApprovalCard } from "@/lib/im/cards";
import { appendMessage, getOrCreateBotConversation } from "@/lib/im/service";
import type { Card } from "@/lib/im/types";
import { seedIm } from "./modules/im";

// 演示账号邮箱 → seed ctx 里的 key
const EMAIL_KEYS: Record<string, string> = {
  "admin@demo.com": "admin",
  "ceo@demo.com": "ceo",
  "sales@demo.com": "sales",
  "sales2@demo.com": "sales2",
  "buyer@demo.com": "buyer",
  "wh@demo.com": "wh",
  "dispatch@demo.com": "dispatch",
  "driver@demo.com": "driver",
  "pm@demo.com": "pm",
  "dev@demo.com": "dev",
  "finance@demo.com": "finance",
};

/**
 * 单独为已有数据库补 IM 演示数据（幂等、非破坏性）：
 * 1) 没有任何群聊时，按基础种子数据创建群聊与单聊；
 * 2) 为还没有机器人会话的用户，用历史 Notification 回填机器人卡片（每用户最早起最多 50 条）。
 */
async function main() {
  const groupCount = await db.conversation.count({ where: { type: "GROUP" } });
  if (groupCount === 0) {
    const userRows = await db.user.findMany({ where: { email: { in: Object.keys(EMAIL_KEYS) } } });
    const users: Record<string, (typeof userRows)[number]> = {};
    for (const u of userRows) {
      const key = EMAIL_KEYS[u.email];
      if (key) users[key] = u;
    }
    if (!users.admin || !users.sales || !users.pm) {
      throw new Error("缺少演示账号，请先运行 pnpm db:seed");
    }
    const customers = await db.customer.findMany({ take: 3, orderBy: { createdAt: "asc" }, select: { id: true } });
    const welcome = await db.document.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    await seedIm({ db, users, customers, docs: { welcome } });
    console.log("→ 已创建 IM 群聊与单聊");
  } else {
    console.log("→ 已存在群聊，跳过群聊/单聊种子");
  }

  // 机器人卡片回填
  const hasBot = new Set(
    (await db.conversationMember.findMany({ where: { conversation: { type: "BOT" } }, select: { userId: true } })).map((r) => r.userId),
  );
  const actors = new Map<string, { id: string; name: string; avatarColor: string } | null>();
  const getActor = async (id: string | null) => {
    if (!id) return null;
    if (!actors.has(id)) {
      actors.set(
        id,
        await db.user.findUnique({ where: { id }, select: { id: true, name: true, avatarColor: true } }),
      );
    }
    return actors.get(id) ?? null;
  };
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true } });
  let backfilled = 0;
  for (const u of users) {
    if (hasBot.has(u.id)) continue;
    const notifications = await db.notification.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const n of notifications) {
      const conv = await getOrCreateBotConversation(db, u.id, botForNotifyType(n.type));
      const approvalMatch = n.link?.match(/^\/oa\/approvals\/([^/?#]+)/);
      let card: Card;
      if (n.type === "approval" && approvalMatch) {
        try {
          card = await buildApprovalCard(db, approvalMatch[1], u.id, { title: n.title, body: n.body, link: n.link });
        } catch {
          card = { template: "generic", title: n.title, body: n.body, link: n.link, actor: await getActor(n.actorId) };
        }
      } else {
        card = { template: "generic", title: n.title, body: n.body, link: n.link, actor: await getActor(n.actorId) };
      }
      await appendMessage(db, {
        conversationId: conv.id,
        senderId: null,
        type: "CARD",
        content: card,
        text: n.title,
        refType: card.ref?.type ?? null,
        refId: card.ref?.id ?? null,
        createdAt: n.createdAt,
      });
      backfilled++;
    }
  }
  if (backfilled) console.log(`→ 已回填 ${backfilled} 条机器人卡片`);

  // ── 幂等修正 ──
  // 1) 历史 BOT 会话补 directKey（"bot:<key>:<uid>"），为并发去重兜底
  const legacyBots = await db.conversation.findMany({
    where: { type: "BOT", directKey: null },
    include: { members: { select: { userId: true } } },
  });
  let keyed = 0;
  for (const conv of legacyBots) {
    const uid = conv.members[0]?.userId;
    if (!uid || !conv.botKey) continue;
    try {
      await db.conversation.update({ where: { id: conv.id }, data: { directKey: `bot:${conv.botKey}:${uid}` } });
      keyed++;
    } catch {
      // directKey 已被更新会话占用：删除该冗余旧会话
      await db.conversation.delete({ where: { id: conv.id } });
    }
  }
  if (legacyBots.length) console.log(`→ 已为 ${keyed} 个机器人会话补 directKey（清理 ${legacyBots.length - keyed} 个）`);

  // 2) 发送者已读位置修正：lastReadSeq ≥ 本人在该会话发出的最大 seq
  const sentMax = await db.message.groupBy({
    by: ["conversationId", "senderId"],
    where: { senderId: { not: null } },
    _max: { seq: true },
  });
  let readFixed = 0;
  for (const row of sentMax) {
    if (!row.senderId || row._max.seq == null) continue;
    const r = await db.conversationMember.updateMany({
      where: { conversationId: row.conversationId, userId: row.senderId, lastReadSeq: { lt: row._max.seq } },
      data: { lastReadSeq: row._max.seq },
    });
    readFixed += r.count;
  }
  if (readFixed) console.log(`→ 已修正 ${readFixed} 个成员的已读位置`);

  console.log(`✓ 完成：会话 ${await db.conversation.count()} 个，消息 ${await db.message.count()} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
