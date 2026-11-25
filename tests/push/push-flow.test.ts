import "./setup-db";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { db, type DbClient } from "@/lib/db";
import { appendMessage, createGroup, getOrCreateDirect, markRead, sendTextMessage, setConversationPrefs } from "@/lib/im/service";
import { listMissedPush } from "@/lib/push/missed";
import { withRealtimeBuffer } from "@/lib/realtime/buffer";
import { notify } from "@/lib/services/notify";

type Published = { userIds: string[]; event: Record<string, unknown> };
let server: Server;
let published: Published[] = [];

const doc = (...nodes: object[]) => ({ type: "doc", content: [{ type: "paragraph", content: nodes }] });
const txt = (text: string) => ({ type: "text", text });
const mention = (id: string, label: string) => ({ type: "mention", attrs: { id, label } });

let alice: { id: string };
let bob: { id: string };
let carol: { id: string };
let botUser: { id: string };
let directId = "";
let groupId = "";
let n = 0;

async function run<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  const { result, flush } = await withRealtimeBuffer(() => db.$transaction((tx) => fn(tx)));
  await flush();
  return result;
}

const send = (conversationId: string, senderId: string, content: object) =>
  run((tx) => sendTextMessage(tx, { conversationId, senderId, content, clientMsgId: `p-${++n}` }));

function pushes(type = "push.notify") {
  return published.filter((p) => p.event.type === type);
}

function notified(userId: string) {
  return pushes()
    .filter((p) => p.userIds.includes(userId))
    .map((p) => p.event.notification as { conversationId: string; title: string; body: string; channel: string; path: string });
}

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/publish") published.push(...(JSON.parse(body).batch as Published[]));
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.REALTIME_INTERNAL_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const role = await db.role.create({ data: { key: "member", name: "成员", permissions: "[]" } });
  const mk = (email: string, name: string, isBot = false) =>
    db.user.create({ data: { email, name, passwordHash: "x", roleId: role.id, isBot } });
  alice = await mk("alice@push.test", "Alice");
  bob = await mk("bob@push.test", "Bob");
  carol = await mk("carol@push.test", "Carol");
  botUser = await mk("bot@push.test", "Echo", true);
  directId = (await getOrCreateDirect(db, alice.id, bob.id)).id;
  groupId = (await run((tx) => createGroup(tx, alice.id, "项目群", [bob.id, carol.id, botUser.id]))).id;
});

beforeEach(() => {
  published = [];
});

after(async () => {
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});

describe("服务端推送派发（realtime 驱动）", () => {
  it("建群的系统消息不产生提醒", async () => {
    published = [];
    await run((tx) => createGroup(tx, alice.id, "临时群", [bob.id]));
    assert.equal(pushes().length, 0);
  });

  it("单聊：只提醒对方；发送者的提醒被撤销（在电脑上回复后手机通知消失）", async () => {
    await send(directId, alice.id, doc(txt("在吗")));
    assert.deepEqual(notified(bob.id), [
      { ...notified(bob.id)[0], conversationId: directId, title: "Alice", body: "在吗", channel: "dm", path: `/messages/${directId}` },
    ]);
    assert.equal(notified(alice.id).length, 0);
    const clears = pushes("push.clear");
    assert.deepEqual(clears.map((c) => c.userIds), [[alice.id]]);
    assert.equal(clears[0].event.conversationId, directId);
  });

  it("群聊：提醒其他真人，机器人账号不提醒；摘要为“发送人：内容”", async () => {
    await send(groupId, alice.id, doc(txt("大家好")));
    const targets = pushes().flatMap((p) => p.userIds).sort();
    assert.deepEqual(targets, [bob.id, carol.id].sort());
    assert.equal(notified(bob.id)[0].title, "项目群");
    assert.equal(notified(bob.id)[0].body, "Alice：大家好");
    assert.equal(notified(bob.id)[0].channel, "group");
  });

  it("免打扰的群不提醒，被 @ 时提醒并走 @我 渠道", async () => {
    await run((tx) => setConversationPrefs(tx, carol.id, groupId, { muted: true }));
    published = [];
    await send(groupId, alice.id, doc(txt("普通消息")));
    assert.equal(notified(carol.id).length, 0);
    assert.equal(notified(bob.id).length, 1);

    published = [];
    await send(groupId, alice.id, doc(mention(carol.id, "Carol"), txt(" 看一下")));
    const [c] = notified(carol.id);
    assert.equal(c.channel, "mention");
    assert.equal(c.body, "[有人@我] Alice：@Carol 看一下");
    await run((tx) => setConversationPrefs(tx, carol.id, groupId, { muted: false }));
  });

  it("机器人账号发消息照常提醒真人，机器人自身不收", async () => {
    await run((tx) =>
      appendMessage(tx, { conversationId: groupId, senderId: botUser.id, type: "TEXT", content: doc(txt("Echo: hi")), text: "Echo: hi" }),
    );
    const targets = pushes().flatMap((p) => p.userIds).sort();
    assert.deepEqual(targets, [alice.id, bob.id, carol.id].sort());
    assert.equal(notified(alice.id)[0].body, "Echo：Echo: hi");
  });

  it("审批通知卡片：进入审批助手会话，标题为机器人名、摘要为卡片标题，走审批/系统渠道", async () => {
    await run((tx) =>
      notify(tx, { userIds: [bob.id], actorId: alice.id, type: "approval", title: "Alice 提交的请假申请待你审批", link: "/oa/approvals/missing" }),
    );
    const [card] = notified(bob.id);
    assert.equal(card.title, "审批助手");
    assert.equal(card.body, "Alice 提交的请假申请待你审批");
    assert.equal(card.channel, "system");
    assert.match(card.path, /^\/messages\//);
    assert.equal(notified(alice.id).length, 0);
  });

  it("标记已读时给本人发 push.clear", async () => {
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: directId }, select: { lastSeq: true } });
    await run((tx) => markRead(tx, bob.id, directId, conv.lastSeq));
    const clears = pushes("push.clear");
    assert.deepEqual(clears.map((c) => c.userIds), [[bob.id]]);
    assert.equal(clears[0].event.seq, conv.lastSeq);
  });

  it("不在实时缓冲区内（种子脚本）写消息时不派发", async () => {
    await appendMessage(db, { conversationId: directId, senderId: alice.id, type: "TEXT", content: doc(txt("seed")), text: "seed" });
    assert.equal(published.length, 0);
  });
});

describe("断线补拉 listMissedPush", () => {
  it("只返回 since 之后、仍未读、按规则需要提醒的消息，每个会话一条", async () => {
    const since = new Date(Date.now() - 1000);
    await new Promise((r) => setTimeout(r, 20));
    const dm = (await getOrCreateDirect(db, carol.id, bob.id)).id;
    await send(dm, carol.id, doc(txt("一")));
    await send(dm, carol.id, doc(txt("二")));
    await send(groupId, alice.id, doc(mention(bob.id, "Bob"), txt(" 在吗")));
    await send(dm, bob.id, doc(txt("我自己发的")));

    // bob 自己发言会把 dm 的已读推进到最新，所以 dm 不再出现；用新的未读覆盖
    await send(dm, carol.id, doc(txt("三")));
    const missed = await listMissedPush(bob.id, since);
    const byConv = new Map(missed.map((m) => [m.conversationId, m]));
    assert.equal(byConv.get(dm)?.count, 1);
    assert.equal(byConv.get(dm)?.body, "三");
    const g = byConv.get(groupId);
    assert.ok(g, "群里 @Bob 的消息应补拉");
    assert.equal(g.channel, "mention");

    const conv = await db.conversation.findUniqueOrThrow({ where: { id: groupId }, select: { lastSeq: true } });
    await run((tx) => markRead(tx, bob.id, groupId, conv.lastSeq));
    const after = await listMissedPush(bob.id, since);
    assert.equal(after.some((m) => m.conversationId === groupId), false);

    assert.equal((await listMissedPush(bob.id, new Date())).length, 0);
  });

  it("免打扰会话的未 @ 消息不补拉", async () => {
    await run((tx) => setConversationPrefs(tx, carol.id, groupId, { muted: true }));
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: groupId }, select: { lastSeq: true } });
    await run((tx) => markRead(tx, carol.id, groupId, conv.lastSeq));
    const since = new Date(Date.now() - 1000);
    await send(groupId, alice.id, doc(txt("免打扰期间")));
    assert.equal((await listMissedPush(carol.id, since)).some((m) => m.conversationId === groupId), false);
    await send(groupId, alice.id, doc(mention(carol.id, "Carol")));
    assert.equal((await listMissedPush(carol.id, since)).find((m) => m.conversationId === groupId)?.channel, "mention");
  });
});
