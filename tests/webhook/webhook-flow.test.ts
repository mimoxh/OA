import "./setup-db";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { db } from "@/lib/db";
import { createGroup, getOrCreateDirect, sendBotReplyMessage, sendTextMessage, appendMessage } from "@/lib/im/service";
import { createWebhookBot, setWebhookBotEnabled, updateBotSchema, updateWebhookBot } from "@/lib/im/webhook-admin";
import { signPayload } from "@/lib/im/webhook-crypto";
import { handleWebhookReply, handleWebhookTyping } from "@/lib/im/webhook-inbound";
import { dispatchMessageWebhooks, pingConnector } from "@/lib/im/webhook-outbound";
import { startOrJoinCall } from "@/lib/im/call-service";
import {
  getChatRunConfigContext,
  getConversationRunConfig,
  resetConversationRunConfig,
  saveConversationRunConfig,
} from "@/lib/im/webhook-run-config";

type Captured = { path: string; headers: IncomingMessage["headers"]; body: string };
let server: Server;
let baseUrl = "";
const received: Captured[] = [];
let hookStatus = 200;

function take(prefix: string) {
  const out = received.filter((r) => r.path.startsWith(prefix));
  for (const r of out) received.splice(received.indexOf(r), 1);
  return out;
}

const doc = (...nodes: object[]) => ({ type: "doc", content: [{ type: "paragraph", content: nodes }] });
const txt = (text: string) => ({ type: "text", text });
const mention = (id: string, label: string) => ({ type: "mention", attrs: { id, label } });

let alice: { id: string };
let bob: { id: string };
let bot: { connectorId: string; botUserId: string; token: string };
let bot2: { connectorId: string; botUserId: string; token: string };
let directId = "";
let groupId = "";
let humanDirectId = "";
let seq = 0;

async function send(conversationId: string, senderId: string, content: object, extra: { replyToId?: string; threadRootId?: string } = {}) {
  const { message } = await db.$transaction((tx) =>
    sendTextMessage(tx, { conversationId, senderId, content, clientMsgId: `c-${++seq}`, ...extra }),
  );
  return message;
}

function replyRequest(connectorId: string, token: string | null, body: unknown) {
  return new Request(`http://oa.test/api/im/webhooks/${connectorId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body });
      const status = req.url?.startsWith("/hook") ? hookStatus : 200;
      res.writeHead(status, { "Content-Type": "application/json" }).end(status === 200 ? "{}" : "boom");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.REALTIME_INTERNAL_URL = baseUrl;
  process.env.OA_PUBLIC_BASE_URL = "https://oa.example.com/";

  const role = await db.role.create({ data: { key: "member", name: "成员", permissions: "[]" } });
  alice = await db.user.create({ data: { email: "alice@test.local", name: "Alice", passwordHash: "x", roleId: role.id, title: "PM" } });
  bob = await db.user.create({ data: { email: "bob@test.local", name: "Bob", passwordHash: "x", roleId: role.id } });
  bot = await db.$transaction((tx) =>
    createWebhookBot(tx, alice.id, {
      name: "Orca",
      avatarColor: "#9065b0",
      description: "Orca Bot",
      outboundUrl: `${baseUrl}/hook/orca`,
      outboundSecret: "s3cret",
      outboundHeaders: '{"X-Custom":"yes"}',
      triggerMode: "mention_only",
    }),
  );
  bot2 = await db.$transaction((tx) =>
    createWebhookBot(tx, alice.id, { name: "Echo", avatarColor: "#2383e2", outboundUrl: `${baseUrl}/hook/echo`, triggerMode: "mention_only" }),
  );
  directId = (await db.$transaction((tx) => getOrCreateDirect(tx, alice.id, bot.botUserId))).id;
  humanDirectId = (await db.$transaction((tx) => getOrCreateDirect(tx, alice.id, bob.id))).id;
  groupId = (await db.$transaction((tx) => createGroup(tx, alice.id, "项目群", [bob.id, bot.botUserId, bot2.botUserId]))).id;
});

after(async () => {
  await db.$disconnect();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Bot 影子账号", () => {
  it("创建时写入 isBot、无权限角色与不可登录密码，凭据加密存储", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: bot.botUserId }, include: { role: true } });
    assert.equal(u.isBot, true);
    assert.equal(u.role.permissions, "[]");
    assert.ok(!u.passwordHash.startsWith("$2"));
    const c = await db.webhookConnector.findUniqueOrThrow({ where: { id: bot.connectorId } });
    assert.ok(!c.outboundUrl.includes("127.0.0.1"));
    assert.ok(c.outboundSecret && !c.outboundSecret.includes("s3cret"));
    assert.ok(c.outboundHeaders && !c.outboundHeaders.includes("X-Custom"));
    assert.ok(!c.inboundTokenHash.includes(bot.token) && c.inboundTokenHash.length === 64);
    assert.ok(bot.token.startsWith(c.inboundTokenPrefix));
  });

  it("与机器人的单聊不能发起音视频通话", async () => {
    await assert.rejects(
      () => db.$transaction((tx) => startOrJoinCall(tx, { userId: alice.id, conversationId: directId, kind: "audio" })),
      /机器人不支持音视频通话/,
    );
  });
});

describe("出站分发", () => {
  it("单聊消息投递到 Orca，payload / 头 / 签名正确，并记录成功日志", async () => {
    const msg = await send(directId, alice.id, doc(txt("你好 /docs/abc")));
    const results = await dispatchMessageWebhooks(msg.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].result.ok, true);
    const [hit] = take("/hook");
    assert.equal(hit.path, "/hook/orca");
    assert.equal(hit.headers["content-type"], "application/json");
    assert.equal(hit.headers["x-oa-webhook-id"], bot.connectorId);
    assert.equal(hit.headers["x-custom"], "yes");
    assert.equal(hit.headers["x-oa-signature"], signPayload("s3cret", hit.body));
    const p = JSON.parse(hit.body);
    assert.equal(hit.headers["x-oa-delivery-id"], p.deliveryId);
    assert.equal(hit.headers["x-oa-timestamp"], p.timestamp);
    assert.equal(p.event, "im.message.created");
    assert.deepEqual(p.connector, { id: bot.connectorId, botUserId: bot.botUserId, botName: "Orca" });
    assert.equal(p.conversation.id, directId);
    assert.equal(p.conversation.type, "DIRECT");
    assert.equal(p.message.id, msg.id);
    assert.equal(p.message.text, "你好 /docs/abc");
    assert.deepEqual(p.message.links, [{ type: "document", id: "abc" }]);
    assert.deepEqual(p.sender, { id: alice.id, name: "Alice", email: "alice@test.local", title: "PM" });
    assert.deepEqual(p.reply, {
      endpoint: `https://oa.example.com/api/im/webhooks/${bot.connectorId}/reply`,
      conversationId: directId,
      threadRootId: null,
      replyToId: msg.id,
    });
    const log = await db.webhookDeliveryLog.findFirstOrThrow({ where: { connectorId: bot.connectorId, messageId: msg.id } });
    assert.equal(log.direction, "OUTBOUND");
    assert.equal(log.status, "SUCCESS");
    assert.equal(log.httpStatus, 200);
  });

  it("群聊普通消息不触发", async () => {
    const msg = await send(groupId, alice.id, doc(txt("大家好")));
    assert.deepEqual(await dispatchMessageWebhooks(msg.id), []);
    assert.equal(take("/hook").length, 0);
  });

  it("群聊 @Bot 只触发被 @ 的机器人", async () => {
    const msg = await send(groupId, alice.id, doc(mention(bot.botUserId, "Orca"), txt(" 帮我看下")));
    const results = await dispatchMessageWebhooks(msg.id);
    assert.deepEqual(results.map((r) => r.connectorId), [bot.connectorId]);
    const hits = take("/hook");
    assert.deepEqual(hits.map((h) => h.path), ["/hook/orca"]);
    assert.equal(JSON.parse(hits[0].body).conversation.name, "项目群");
    assert.equal(hits[0].headers["x-oa-signature"], signPayload("s3cret", hits[0].body));
    assert.equal(take("/hook").length, 0);
  });

  it("群聊 @所有人 触发全部机器人", async () => {
    const msg = await send(groupId, bob.id, doc(mention("all", "所有人"), txt(" 开会")));
    const results = await dispatchMessageWebhooks(msg.id);
    assert.equal(results.length, 2);
    assert.deepEqual(take("/hook").map((h) => h.path).sort(), ["/hook/echo", "/hook/orca"]);
    assert.equal(results.find((r) => r.connectorId === bot2.connectorId)?.result.ok, true);
  });

  it("群聊回复 Bot 的消息时触发，threadRootId 透传", async () => {
    const botMsg = await db.$transaction((tx) => sendBotReplyMessage(tx, { conversationId: groupId, botUserId: bot.botUserId, text: "我是 Orca" }));
    const msg = await send(groupId, bob.id, doc(txt("收到")), { replyToId: botMsg.message.id });
    assert.equal((await dispatchMessageWebhooks(msg.id)).length, 1);
    assert.equal(take("/hook")[0].path, "/hook/orca");

    const inThread = await send(groupId, bob.id, doc(txt("话题里继续")), { threadRootId: botMsg.message.id });
    assert.equal((await dispatchMessageWebhooks(inThread.id)).length, 1);
    const p = JSON.parse(take("/hook")[0].body);
    assert.equal(p.reply.threadRootId, botMsg.message.id);
  });

  it("防循环：机器人发送的消息（即使 @ 另一个机器人）与系统消息都不触发", async () => {
    const botMsg = await db.$transaction((tx) =>
      sendBotReplyMessage(tx, { conversationId: groupId, botUserId: bot.botUserId, text: "@Echo 你好" }),
    );
    await db.message.update({ where: { id: botMsg.message.id }, data: { mentions: JSON.stringify([bot2.botUserId, "all"]) } });
    assert.deepEqual(await dispatchMessageWebhooks(botMsg.message.id), []);
    const directBotMsg = await db.$transaction((tx) => sendBotReplyMessage(tx, { conversationId: directId, botUserId: bot.botUserId, text: "hi" }));
    assert.deepEqual(await dispatchMessageWebhooks(directBotMsg.message.id), []);
    const sys = await db.$transaction((tx) =>
      appendMessage(tx, { conversationId: directId, senderId: null, type: "SYSTEM", content: { text: "系统" }, text: "系统" }),
    );
    assert.deepEqual(await dispatchMessageWebhooks(sys.message.id), []);
    assert.equal(take("/hook").length, 0);
  });

  it("triggerMode=all 时群聊普通消息也触发", async () => {
    await db.$transaction((tx) =>
      updateWebhookBot(tx, { id: bot2.connectorId, name: "Echo", avatarColor: "#2383e2", triggerMode: "all" }),
    );
    const msg = await send(groupId, alice.id, doc(txt("普通消息")));
    assert.deepEqual((await dispatchMessageWebhooks(msg.id)).map((r) => r.connectorId), [bot2.connectorId]);
    assert.equal(take("/hook")[0].path, "/hook/echo");
    await db.$transaction((tx) =>
      updateWebhookBot(tx, { id: bot2.connectorId, name: "Echo", avatarColor: "#2383e2", triggerMode: "mention_only" }),
    );
  });

  it("停用的机器人不触发；目标返回 500 时记录失败日志且不抛出", async () => {
    await db.$transaction((tx) => setWebhookBotEnabled(tx, bot2.connectorId, false));
    const m1 = await send(groupId, alice.id, doc(mention("all", "所有人")));
    assert.deepEqual((await dispatchMessageWebhooks(m1.id)).map((r) => r.connectorId), [bot.connectorId]);
    take("/hook");
    await db.$transaction((tx) => setWebhookBotEnabled(tx, bot2.connectorId, true));

    hookStatus = 500;
    try {
      const msg = await send(directId, alice.id, doc(txt("会失败")));
      const [r] = await dispatchMessageWebhooks(msg.id);
      assert.equal(r.result.ok, false);
      assert.equal(r.result.httpStatus, 500);
      take("/hook");
      const log = await db.webhookDeliveryLog.findFirstOrThrow({ where: { messageId: msg.id } });
      assert.equal(log.status, "FAILED");
      assert.equal(log.httpStatus, 500);
      assert.match(log.error ?? "", /HTTP 500/);
    } finally {
      hookStatus = 200;
    }
  });

  it("连通性测试发送 webhook.ping", async () => {
    const r = await pingConnector(bot.connectorId);
    assert.equal(r.ok, true);
    assert.equal(r.httpStatus, 200);
    const [hit] = take("/hook");
    assert.equal(JSON.parse(hit.body).event, "webhook.ping");
    assert.equal(hit.headers["x-oa-signature"], signPayload("s3cret", hit.body));
  });
});

describe("入站回复", () => {
  it("缺少 / 错误 Token 或未知连接器返回 401", async () => {
    for (const [cid, token] of [
      [bot.connectorId, null],
      [bot.connectorId, "whsec_wrong"],
      [bot.connectorId, bot2.token],
      ["does-not-exist", bot.token],
    ] as const) {
      const res = await handleWebhookReply(replyRequest(cid, token, { conversationId: directId, text: "x" }), cid);
      assert.equal(res.status, 401, `${cid} ${token}`);
    }
  });

  it("停用的连接器返回 403", async () => {
    await db.$transaction((tx) => setWebhookBotEnabled(tx, bot.connectorId, false));
    try {
      const res = await handleWebhookReply(replyRequest(bot.connectorId, bot.token, { conversationId: directId, text: "x" }), bot.connectorId);
      assert.equal(res.status, 403);
    } finally {
      await db.$transaction((tx) => setWebhookBotEnabled(tx, bot.connectorId, true));
    }
  });

  it("向机器人不在的会话发消息被拒绝（403），且不入库", async () => {
    const before = await db.message.count({ where: { conversationId: humanDirectId } });
    const res = await handleWebhookReply(replyRequest(bot.connectorId, bot.token, { conversationId: humanDirectId, text: "越权" }), bot.connectorId);
    assert.equal(res.status, 403);
    assert.equal(await db.message.count({ where: { conversationId: humanDirectId } }), before);
  });

  it("请求体无效返回 400", async () => {
    const res = await handleWebhookReply(replyRequest(bot.connectorId, bot.token, { conversationId: directId }), bot.connectorId);
    assert.equal(res.status, 400);
    const res2 = await handleWebhookReply(
      replyRequest(bot.connectorId, bot.token, { conversationId: directId, card: { title: "x", link: "javascript:alert(1)" } }),
      bot.connectorId,
    );
    assert.equal(res2.status, 400);
  });

  it("正常回复入库、推送 message.new、clientMsgId 幂等，且不会回环触发出站", async () => {
    take("/publish");
    const body = { conversationId: directId, text: "这是回复\n第二行 https://oa.example.com/docs/xyz", clientMsgId: "orca-delivery-1" };
    const res = await handleWebhookReply(replyRequest(bot.connectorId, bot.token, body), bot.connectorId);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok: boolean; created: boolean; messageId: string; seq: number };
    assert.equal(data.ok, true);
    assert.equal(data.created, true);

    const msg = await db.message.findUniqueOrThrow({ where: { id: data.messageId } });
    assert.equal(msg.senderId, bot.botUserId);
    assert.equal(msg.type, "TEXT");
    assert.equal(msg.text, body.text);
    assert.deepEqual(JSON.parse(msg.links), [{ type: "document", id: "xyz" }]);
    assert.equal(JSON.parse(msg.content).content.length, 2);

    const publishes = take("/publish");
    assert.equal(publishes.length, 1);
    assert.match(String(publishes[0].headers.authorization), /^Bearer /);
    const batch = JSON.parse(publishes[0].body).batch as { userIds: string[]; event: { type: string; message: { id: string } } }[];
    const evt = batch.find((b) => b.event.type === "message.new");
    assert.ok(evt);
    assert.equal(evt.event.message.id, data.messageId);
    assert.ok(evt.userIds.includes(alice.id));

    const aliceMember = await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: directId, userId: alice.id } } });
    assert.ok(aliceMember.lastReadSeq < data.seq, "对 Alice 产生未读");

    const count = await db.message.count({ where: { conversationId: directId } });
    const again = await handleWebhookReply(replyRequest(bot.connectorId, bot.token, body), bot.connectorId);
    assert.equal(again.status, 200);
    const againData = (await again.json()) as { created: boolean; messageId: string };
    assert.equal(againData.created, false);
    assert.equal(againData.messageId, data.messageId);
    assert.equal(await db.message.count({ where: { conversationId: directId } }), count);

    assert.deepEqual(await dispatchMessageWebhooks(data.messageId), []);
    assert.equal(take("/hook").length, 0);

    const log = await db.webhookDeliveryLog.findFirstOrThrow({ where: { direction: "INBOUND", messageId: data.messageId } });
    assert.equal(log.status, "SUCCESS");
  });

  it("支持通用卡片与 replyToId / threadRootId", async () => {
    const userMsg = await send(groupId, alice.id, doc(mention(bot.botUserId, "Orca"), txt(" 发个卡片")));
    take("/hook");
    const res = await handleWebhookReply(
      replyRequest(bot.connectorId, bot.token, {
        conversationId: groupId,
        card: { title: "构建完成", body: "全部通过", link: "/pms/projects/p1", fields: [{ label: "耗时", value: "3m" }] },
        threadRootId: userMsg.id,
        replyToId: userMsg.id,
      }),
      bot.connectorId,
    );
    assert.equal(res.status, 200);
    const { messageId } = (await res.json()) as { messageId: string };
    const msg = await db.message.findUniqueOrThrow({ where: { id: messageId } });
    assert.equal(msg.type, "CARD");
    assert.equal(msg.threadRootId, userMsg.id);
    assert.equal(msg.replyToId, userMsg.id);
    assert.equal(JSON.parse(msg.content).template, "generic");
    const root = await db.message.findUniqueOrThrow({ where: { id: userMsg.id } });
    assert.equal(root.threadCount, 1);
  });

  it("typing 接口鉴权、成员校验并广播 typing 事件", async () => {
    take("/publish");
    const mk = (cid: string, token: string, conversationId: string) =>
      handleWebhookTyping(
        new Request(`http://oa.test/api/im/webhooks/${cid}/typing`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        }),
        cid,
      );
    assert.equal((await mk(bot.connectorId, "whsec_bad", directId)).status, 401);
    assert.equal((await mk(bot.connectorId, bot.token, humanDirectId)).status, 403);
    assert.equal(take("/publish").length, 0);
    assert.equal((await mk(bot.connectorId, bot.token, directId)).status, 200);
    const [pub] = take("/publish");
    const [item] = JSON.parse(pub.body).batch;
    assert.deepEqual(item.event, { type: "typing", conversationId: directId, userId: bot.botUserId });
    assert.deepEqual(item.userIds, [alice.id]);
  });
});

describe("出站 metadata（基座 / 模型 / 思考强度）", () => {
  const orca = (extra: Record<string, unknown> = {}) => ({ id: bot.connectorId, name: "Orca", avatarColor: "#9065b0", triggerMode: "mention_only" as const, ...extra });
  async function directMetadata() {
    const msg = await send(directId, alice.id, doc(txt("metadata?")));
    const [r] = await dispatchMessageWebhooks(msg.id);
    assert.equal(r.result.ok, true);
    const [hit] = take("/hook");
    return JSON.parse(hit.body).metadata;
  }

  it("默认全空时 metadata 字段全部为 null（消息与 ping）", async () => {
    take("/hook");
    assert.deepEqual(await directMetadata(), { agent: null, model: null, effort: null });
    await pingConnector(bot.connectorId);
    assert.deepEqual(JSON.parse(take("/hook")[0].body).metadata, { agent: null, model: null, effort: null });
  });

  it("仅机器人默认：空白归一化为 null，ping 同样携带默认值", async () => {
    await db.$transaction((tx) =>
      updateWebhookBot(tx, updateBotSchema.parse(orca({ defaultAgent: " Droid ", defaultModel: "   ", defaultEffort: "HIGH" }))),
    );
    const c = await db.webhookConnector.findUniqueOrThrow({ where: { id: bot.connectorId } });
    assert.deepEqual([c.defaultAgent, c.defaultModel, c.defaultEffort], ["droid", null, "high"]);
    assert.deepEqual(await directMetadata(), { agent: "droid", model: null, effort: "high" });
    await pingConnector(bot.connectorId);
    const ping = take("/hook")[0];
    assert.deepEqual(JSON.parse(ping.body).metadata, { agent: "droid", model: null, effort: "high" });
    assert.equal(ping.headers["x-oa-signature"], signPayload("s3cret", ping.body));
  });

  it("不传默认字段的编辑保持原值", async () => {
    await db.$transaction((tx) => updateWebhookBot(tx, orca()));
    const c = await db.webhookConnector.findUniqueOrThrow({ where: { id: bot.connectorId } });
    assert.deepEqual([c.defaultAgent, c.defaultModel, c.defaultEffort], ["droid", null, "high"]);
  });

  it("会话覆盖逐字段优先于机器人默认，并持久化", async () => {
    await saveConversationRunConfig(db, directId, alice.id, { model: " claude-opus-5-5 " });
    assert.deepEqual(await directMetadata(), { agent: "droid", model: "claude-opus-5-5", effort: "high" });
    await saveConversationRunConfig(db, directId, alice.id, { agent: "codex", effort: "xhigh" });
    assert.deepEqual(await getConversationRunConfig(db, directId), { agent: "codex", model: "claude-opus-5-5", effort: "xhigh" });
    assert.deepEqual(await directMetadata(), { agent: "codex", model: "claude-opus-5-5", effort: "xhigh" });
    await saveConversationRunConfig(db, directId, alice.id, { model: "" });
    assert.deepEqual(await directMetadata(), { agent: "codex", model: null, effort: "xhigh" });
  });

  it("恢复机器人默认：删除会话配置并回退", async () => {
    await resetConversationRunConfig(db, directId);
    assert.equal(await db.webhookConversationConfig.count({ where: { conversationId: directId } }), 0);
    assert.deepEqual(await directMetadata(), { agent: "droid", model: null, effort: "high" });
    await saveConversationRunConfig(db, directId, alice.id, { effort: "low" });
    await saveConversationRunConfig(db, directId, alice.id, { effort: null });
    assert.equal(await db.webhookConversationConfig.count({ where: { conversationId: directId } }), 0, "全部清空等价于重置");
  });

  it("非法 effort / 基座被拒绝且不落库", async () => {
    await assert.rejects(() => saveConversationRunConfig(db, directId, alice.id, { effort: "max" }), /low \/ medium \/ high \/ xhigh/);
    await assert.rejects(() => saveConversationRunConfig(db, directId, alice.id, { agent: "bad agent" }), /基座标识/);
    assert.equal(await db.webhookConversationConfig.count({ where: { conversationId: directId } }), 0);
  });

  it("群聊覆盖作用于群内所有机器人，各自与默认合并", async () => {
    await saveConversationRunConfig(db, groupId, bob.id, { effort: "medium" });
    const msg = await send(groupId, alice.id, doc(mention("all", "所有人")));
    assert.equal((await dispatchMessageWebhooks(msg.id)).length, 2);
    const byPath = Object.fromEntries(take("/hook").map((h) => [h.path, JSON.parse(h.body).metadata]));
    assert.deepEqual(byPath["/hook/orca"], { agent: "droid", model: null, effort: "medium" });
    assert.deepEqual(byPath["/hook/echo"], { agent: null, model: null, effort: "medium" });
    assert.deepEqual(await getConversationRunConfig(db, directId), { agent: null, model: null, effort: null }, "单聊不受群聊覆盖影响");
  });

  it("选择器上下文：仅含已启用 Webhook 机器人的单聊 / 群聊", async () => {
    const direct = await getChatRunConfigContext(db, directId);
    assert.deepEqual(direct?.bots.map((b) => [b.name, b.defaults]), [["Orca", { agent: "droid", model: null, effort: "high" }]]);
    assert.equal(await getChatRunConfigContext(db, humanDirectId), null);
    const group = await getChatRunConfigContext(db, groupId);
    assert.deepEqual(group?.bots.map((b) => b.name).sort(), ["Echo", "Orca"]);
    assert.deepEqual(group?.override, { agent: null, model: null, effort: "medium" });
    await db.$transaction((tx) => setWebhookBotEnabled(tx, bot.connectorId, false));
    try {
      assert.equal(await getChatRunConfigContext(db, directId), null);
      assert.deepEqual((await getChatRunConfigContext(db, groupId))?.bots.map((b) => b.name), ["Echo"]);
    } finally {
      await db.$transaction((tx) => setWebhookBotEnabled(tx, bot.connectorId, true));
    }
  });
});
