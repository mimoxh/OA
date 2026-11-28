import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNotification,
  collapseByConversation,
  computePushNotifications,
  MENTION_ALL_PREFIX,
  MENTION_PREFIX,
  summarizeMessage,
  type PushConversation,
  type PushMessage,
  type PushRecipient,
} from "@/lib/push/rules";
import { toRealtimeEvents } from "@/lib/push/drivers/realtime";
import { activePushDrivers, deliverPush, planPush } from "@/lib/push/drivers";
import { realtimeDriver } from "@/lib/push/drivers/realtime";
import { jpushDriver } from "@/lib/push/drivers/jpush";

const direct: PushConversation = { id: "c-dm", type: "DIRECT", name: null, botKey: null };
const group: PushConversation = { id: "c-group", type: "GROUP", name: "项目群", botKey: null };
const approvalBot: PushConversation = { id: "c-bot", type: "BOT", name: null, botKey: "approval" };

const msg = (over: Partial<PushMessage> = {}): PushMessage => ({
  id: "m1",
  seq: 7,
  type: "TEXT",
  senderId: "alice",
  senderName: "Alice",
  text: "明天 10 点开会",
  content: null,
  mentions: [],
  createdAt: "2026-11-25T08:00:00.000Z",
  ...over,
});

const person = (userId: string, over: Partial<PushRecipient> = {}): PushRecipient => ({
  userId,
  muted: false,
  isBot: false,
  active: true,
  ...over,
});

describe("推送规则：接收人", () => {
  it("跳过发送者本人", () => {
    const out = computePushNotifications(direct, msg(), [person("alice"), person("bob")]);
    assert.deepEqual(out.map((n) => n.userId), ["bob"]);
  });

  it("跳过机器人账号和已停用账号", () => {
    const out = computePushNotifications(group, msg(), [person("bob"), person("echo-bot", { isBot: true }), person("gone", { active: false })]);
    assert.deepEqual(out.map((n) => n.userId), ["bob"]);
  });

  it("机器人发出的消息照常提醒真人", () => {
    const out = computePushNotifications(direct, msg({ senderId: "echo-bot", senderName: "Echo" }), [person("echo-bot", { isBot: true }), person("bob")]);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "Echo");
  });

  it("免打扰会话不提醒，被 @ 或 @所有人 时提醒", () => {
    const muted = [person("bob", { muted: true }), person("carol", { muted: true })];
    assert.equal(computePushNotifications(group, msg(), muted).length, 0);
    const atBob = computePushNotifications(group, msg({ mentions: ["bob"] }), muted);
    assert.deepEqual(atBob.map((n) => n.userId), ["bob"]);
    const atAll = computePushNotifications(group, msg({ mentions: ["all"] }), muted);
    assert.deepEqual(atAll.map((n) => n.userId), ["bob", "carol"]);
  });

  it("系统消息与已撤回消息不提醒", () => {
    assert.equal(computePushNotifications(group, msg({ type: "SYSTEM", senderId: null }), [person("bob")]).length, 0);
    assert.equal(computePushNotifications(group, msg({ recalled: true }), [person("bob")]).length, 0);
  });

  it("同一接收人只算一次", () => {
    assert.equal(computePushNotifications(group, msg(), [person("bob"), person("bob")]).length, 1);
  });
});

describe("推送规则：标题、摘要与渠道", () => {
  it("单聊：标题为对方姓名，摘要为正文，走单聊渠道", () => {
    const n = buildNotification(direct, msg(), "bob");
    assert.equal(n.title, "Alice");
    assert.equal(n.body, "明天 10 点开会");
    assert.equal(n.channel, "dm");
    assert.equal(n.path, "/messages/c-dm");
    assert.equal(n.sentAt, "2026-11-25T08:00:00.000Z");
  });

  it("群聊：标题为群名，摘要为“发送人：内容”", () => {
    const n = buildNotification(group, msg(), "bob");
    assert.equal(n.title, "项目群");
    assert.equal(n.body, "Alice：明天 10 点开会");
    assert.equal(n.channel, "group");
  });

  it("群名为空时用“群聊”", () => {
    assert.equal(buildNotification({ ...group, name: "  " }, msg(), "bob").title, "群聊");
  });

  it("被 @ 时加前缀并走 @我 渠道；@所有人 用另一前缀", () => {
    const atMe = buildNotification(group, msg({ mentions: ["bob"] }), "bob");
    assert.equal(atMe.body, `${MENTION_PREFIX}Alice：明天 10 点开会`);
    assert.equal(atMe.channel, "mention");
    assert.equal(atMe.mentioned, true);
    const atAll = buildNotification(group, msg({ mentions: ["all"] }), "bob");
    assert.ok(atAll.body.startsWith(MENTION_ALL_PREFIX));
    assert.equal(atAll.channel, "mention");
    const other = buildNotification(group, msg({ mentions: ["carol"] }), "bob");
    assert.equal(other.channel, "group");
    assert.equal(other.mentioned, false);
  });

  it("机器人会话的卡片：标题为机器人名，摘要为卡片标题，走审批/系统渠道", () => {
    const card = msg({ type: "CARD", senderId: null, senderName: null, text: "请假申请", content: { template: "approval", title: "张伟提交的请假申请待你审批" } });
    const n = buildNotification(approvalBot, card, "bob");
    assert.equal(n.title, "审批助手");
    assert.equal(n.body, "张伟提交的请假申请待你审批");
    assert.equal(n.channel, "system");
  });

  it("未知机器人归到“系统通知”", () => {
    const n = buildNotification({ ...approvalBot, botKey: "nope" }, msg({ type: "CARD", senderId: null, content: { title: "x" } }), "bob");
    assert.equal(n.title, "系统通知");
  });

  it("群里由真人分享的卡片仍是群聊渠道，摘要用卡片标题", () => {
    const n = buildNotification(group, msg({ type: "CARD", content: { title: "Q4 预算" }, text: "" }), "bob");
    assert.equal(n.body, "Alice：Q4 预算");
    assert.equal(n.channel, "group");
  });

  it("图片、文件、空文本的摘要", () => {
    assert.equal(summarizeMessage({ type: "IMAGE", text: "", content: {} }), "[图片]");
    assert.equal(summarizeMessage({ type: "FILE", text: "", content: { filename: "合同.pdf" } }), "[文件] 合同.pdf");
    assert.equal(summarizeMessage({ type: "FILE", text: "", content: {} }), "[文件]");
    assert.equal(summarizeMessage({ type: "TEXT", text: "   ", content: null }), "发来一条消息");
    assert.equal(summarizeMessage({ type: "CARD", text: "", content: null }), "[卡片消息]");
  });

  it("长文本截断并合并空白", () => {
    const s = summarizeMessage({ type: "TEXT", text: `第一行\n\n${"字".repeat(200)}`, content: null });
    assert.ok(s.startsWith("第一行 字"));
    assert.ok(s.endsWith("…"));
    assert.equal(s.length, 101);
  });
});

describe("补拉汇总", () => {
  it("同一会话合并为一条，标注条数，任一条 @我 则走 @我 渠道", () => {
    const a = buildNotification(group, msg({ id: "m1", seq: 1, text: "第一条" }), "bob");
    const b = buildNotification(group, msg({ id: "m2", seq: 2, text: "第二条", mentions: ["bob"] }), "bob");
    const c = buildNotification(group, msg({ id: "m3", seq: 3, text: "第三条" }), "bob");
    const d = buildNotification(direct, msg({ id: "m4", seq: 1, text: "单聊" }), "bob");
    const out = collapseByConversation([a, b, c, d]);
    assert.equal(out.length, 2);
    const g = out.find((n) => n.conversationId === "c-group")!;
    assert.equal(g.count, 3);
    assert.equal(g.seq, 3);
    assert.equal(g.channel, "mention");
    assert.equal(g.body, "[3条] Alice：第三条");
    const dm = out.find((n) => n.conversationId === "c-dm")!;
    assert.equal(dm.count, 1);
    assert.equal(dm.body, "单聊");
  });
});

describe("推送驱动", () => {
  it("realtime 驱动把提醒和撤销转成定向事件，事件里不带 userId", () => {
    const n = buildNotification(direct, msg(), "bob");
    const events = toRealtimeEvents([
      { kind: "notify", notification: n },
      { kind: "clear", userId: "bob", conversationId: "c-dm", seq: 7 },
    ]);
    assert.deepEqual(events[0].userIds, ["bob"]);
    assert.equal(events[0].event.type, "push.notify");
    assert.equal((events[0].event.notification as { userId?: string }).userId, undefined);
    assert.deepEqual(events[1], { userIds: ["bob"], event: { type: "push.clear", conversationId: "c-dm", seq: 7 } });
  });

  it("PUSH_DRIVERS 选择驱动，默认 realtime，未知名称忽略", () => {
    const prev = process.env.PUSH_DRIVERS;
    try {
      delete process.env.PUSH_DRIVERS;
      assert.deepEqual(activePushDrivers().map((d) => d.name), ["realtime"]);
      process.env.PUSH_DRIVERS = "realtime, jpush ,nope";
      assert.deepEqual(activePushDrivers().map((d) => d.name), ["realtime", "jpush"]);
    } finally {
      if (prev === undefined) delete process.env.PUSH_DRIVERS;
      else process.env.PUSH_DRIVERS = prev;
    }
  });

  it("单个驱动失败不影响其他驱动，也不抛出", async () => {
    const got: string[] = [];
    await deliverPush(
      [{ kind: "clear", userId: "bob", conversationId: "c", seq: 1 }],
      [
        { name: "bad", send: async () => Promise.reject(new Error("boom")) },
        { name: "good", send: async (items) => void got.push(...items.map((i) => i.kind)) },
      ],
    );
    assert.deepEqual(got, ["clear"]);
  });

  it("realtime 驱动的事件并入同一批实时事件，其余驱动单独发送", () => {
    const items = [{ kind: "clear" as const, userId: "bob", conversationId: "c", seq: 1 }];
    const both = planPush(items, [realtimeDriver, jpushDriver]);
    assert.deepEqual(both.events, [{ userIds: ["bob"], event: { type: "push.clear", conversationId: "c", seq: 1 } }]);
    assert.deepEqual(both.others, [jpushDriver]);
    const only = planPush(items, [jpushDriver]);
    assert.deepEqual(only.events, []);
    assert.deepEqual(only.others, [jpushDriver]);
    assert.deepEqual(planPush([], [realtimeDriver]).events, []);
  });
});
