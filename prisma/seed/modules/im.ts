import type { User } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import { appendMessage, getOrCreateDirect } from "@/lib/im/service";
import { parseMessageContent } from "@/lib/im/content";

/** 仅 IM 种子需要的上下文；完整 SeedContext 结构兼容 */
export type ImSeedContext = {
  db: DbClient;
  users: Record<string, User>;
  customers: { id: string }[];
  docs: { welcome?: { id: string } | null };
};

/** 文本消息 → Tiptap doc */
function textDoc(text: string, mention?: { id: string; label: string }) {
  const content: unknown[] = [];
  if (mention) {
    // 约定：文本中以「@名字」开头表示提及
    const idx = text.indexOf(`@${mention.label}`);
    if (idx >= 0) {
      const before = text.slice(0, idx);
      const after = text.slice(idx + mention.label.length + 1);
      if (before) content.push({ type: "text", text: before });
      content.push({ type: "mention", attrs: { id: mention.id, label: mention.label } });
      if (after) content.push({ type: "text", text: after });
    } else {
      content.push({ type: "text", text });
    }
  } else {
    content.push({ type: "text", text });
  }
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

/** IM 演示数据：群聊 + 单聊。幂等——已有同名群聊/消息时跳过。 */
export async function seedIm(ctx: ImSeedContext) {
  const { db, users } = ctx;

  // ── 群聊 ──
  const allMembers = Object.values(users).map((u) => u.id);
  const groupDefs = [
    { key: "all", name: "全员群", owner: "admin" as const, members: allMembers },
    { key: "sales", name: "销售部", owner: "sales" as const, members: [users.sales.id, users.sales2.id] },
    {
      key: "pms",
      name: "协作平台 2.0 项目组",
      owner: "pm" as const,
      members: [users.pm.id, users.dev.id, users.admin.id],
    },
  ];
  for (const def of groupDefs) {
    const existing = await db.conversation.findFirst({ where: { type: "GROUP", name: def.name } });
    if (existing) continue;
    const conv = await db.conversation.create({
      data: {
        type: "GROUP",
        name: def.name,
        ownerId: users[def.owner].id,
        createdAt: daysAgo(3),
        members: {
          create: def.members.map((userId, i) => ({
            userId,
            role: i === 0 ? ("OWNER" as const) : ("MEMBER" as const),
          })),
        },
      },
    });
    await appendMessage(db, {
      conversationId: conv.id,
      senderId: null,
      type: "SYSTEM",
      content: { text: `${users[def.owner].name} 创建了群聊` },
      text: `${users[def.owner].name} 创建了群聊`,
      createdAt: daysAgo(3),
      readBy: users[def.owner].id,
    });
  }

  // ── 群消息 ──
  const allGroup = await db.conversation.findFirst({ where: { type: "GROUP", name: "全员群" } });
  if (allGroup && (await db.message.count({ where: { conversationId: allGroup.id, type: "TEXT" } })) === 0) {
    const msgs: [string, string, Date][] = [
      [users.admin.id, "各位同事早上好，协作平台今天上线试运行，有问题随时在群里反馈。", daysAgo(2)],
      [users.ceo.id, "收到，请大家把常用功能先熟悉起来，周会上我们统一收一下反馈。", daysAgo(2)],
      [users.pm.id, "文档协同已经可用了，建议项目组的需求文档都迁过来。", daysAgo(1)],
    ];
    for (const [senderId, text, at] of msgs) {
      await appendMessage(db, {
        conversationId: allGroup.id,
        senderId,
        type: "TEXT",
        content: textDoc(text),
        text,
        createdAt: at,
      });
    }
  }
  const salesGroup = await db.conversation.findFirst({ where: { type: "GROUP", name: "销售部" } });
  if (salesGroup && (await db.message.count({ where: { conversationId: salesGroup.id, type: "TEXT" } })) === 0) {
    const customer = ctx.customers[0];
    const msgs: [string, string, Date, { id: string; label: string }?][] = [
      [users.sales.id, "本周星辰网络的续约合同要重点跟一下，商务条款我下午发群里。", daysAgo(1)],
      [
        users.sales2.id,
        `@${users.sales.name} 收到，我先把客户资料更新一下 /crm/customers/${customer?.id}`,
        daysAgo(1),
        { id: users.sales.id, label: users.sales.name },
      ],
      [users.sales.id, "好，云帆那边的回款也盯一下。", hoursAgo(3)],
    ];
    for (const [senderId, text, at, mention] of msgs) {
      const parsed = parseMessageContent(textDoc(text, mention));
      await appendMessage(db, {
        conversationId: salesGroup.id,
        senderId,
        type: "TEXT",
        content: parsed.content,
        text: parsed.text,
        mentions: parsed.mentions,
        links: parsed.links,
        createdAt: at,
      });
    }
  }

  // ── 单聊 ──
  const welcome = ctx.docs.welcome;
  const pairs: { a: keyof typeof users; b: keyof typeof users; msgs: [keyof: string, string, Date][] }[] = [
    {
      a: "admin",
      b: "sales",
      msgs: [
        ["a", "李娜，CRM 里星辰网络的联系人电话记得补一下。", daysAgo(2)],
        ["b", `好的张总，已经补了。另外这篇使用手册不错，转给团队看看 /docs/${welcome?.id}`, daysAgo(2)],
        ["a", "行，有问题随时说。", hoursAgo(5)],
      ],
    },
    {
      a: "pm",
      b: "dev",
      msgs: [
        ["a", "孙浩，消息模块的消息气泡样式今天能出个初版吗？", hoursAgo(26)],
        ["b", "可以，我先按飞书的样子做，下午给你看。", hoursAgo(25)],
        ["a", "好，别忘了把撤回消息的样式也带上。", hoursAgo(24)],
      ],
    },
    {
      a: "dispatch",
      b: "driver",
      msgs: [
        ["a", "郑强，明天上午有一单从上海仓发杭州的货，车牌我一会儿派给你。", hoursAgo(8)],
        ["b", "收到，明早 7 点前到仓库。", hoursAgo(7)],
      ],
    },
  ];
  for (const pair of pairs) {
    const a = users[pair.a];
    const b = users[pair.b];
    const conv = await getOrCreateDirect(db, a.id, b.id);
    if ((await db.message.count({ where: { conversationId: conv.id } })) > 0) continue;
    for (const [who, text, at] of pair.msgs) {
      const sender = who === "a" ? a : b;
      const parsed = parseMessageContent(textDoc(text));
      await appendMessage(db, {
        conversationId: conv.id,
        senderId: sender.id,
        type: "TEXT",
        content: parsed.content,
        text: parsed.text,
        mentions: parsed.mentions,
        links: parsed.links,
        createdAt: at,
      });
    }
  }
}
