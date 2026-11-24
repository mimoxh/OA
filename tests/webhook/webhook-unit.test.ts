import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import * as crypto from "@/lib/im/webhook-crypto";
import { shouldTriggerWebhook } from "@/lib/im/webhook-outbound";
import { BOT_PASSWORD_HASH } from "@/lib/im/webhook-admin";

process.env.AUTH_SECRET ??= "test-secret-for-webhook-unit-tests-0123456789";

const BOT = "bot-1";
const human = { id: "u-1", isBot: false };
const base = { messageType: "TEXT", triggerMode: "mention_only", botUserId: BOT, sender: human, mentions: [] as string[] };

describe("shouldTriggerWebhook", () => {
  it("单聊始终触发", () => {
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "DIRECT" }), true);
  });
  it("群聊普通消息在 mention_only 下不触发", () => {
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP" }), false);
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", mentions: ["someone-else"] }), false);
  });
  it("群聊 @Bot / @all 触发", () => {
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", mentions: [BOT] }), true);
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", mentions: ["all"] }), true);
  });
  it("群聊回复 Bot 的消息（或在 Bot 发起的话题中回复）触发", () => {
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", replyToSenderId: BOT }), true);
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", threadRootSenderId: BOT }), true);
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", replyToSenderId: "u-2" }), false);
  });
  it("群聊 triggerMode=all 时普通消息也触发", () => {
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "GROUP", triggerMode: "all" }), true);
  });
  it("防循环：isBot 发送者或 senderId 为空时一律不触发", () => {
    for (const conversationType of ["DIRECT", "GROUP"]) {
      for (const triggerMode of ["mention_only", "all"]) {
        assert.equal(shouldTriggerWebhook({ ...base, conversationType, triggerMode, mentions: [BOT, "all"], sender: { id: "bot-2", isBot: true } }), false);
        assert.equal(shouldTriggerWebhook({ ...base, conversationType, triggerMode, mentions: [BOT, "all"], sender: { id: null, isBot: false } }), false);
        assert.equal(shouldTriggerWebhook({ ...base, conversationType, triggerMode, mentions: [BOT], sender: null }), false);
        assert.equal(shouldTriggerWebhook({ ...base, conversationType, triggerMode, sender: { id: BOT, isBot: false } }), false);
      }
    }
  });
  it("系统消息与机器人通知会话不触发", () => {
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "DIRECT", messageType: "SYSTEM" }), false);
    assert.equal(shouldTriggerWebhook({ ...base, conversationType: "BOT", triggerMode: "all" }), false);
  });
});

describe("凭据加解密", () => {
  it("AES-256-GCM 往返且每次密文不同", () => {
    const a = crypto.encryptSecret("https://hooks.example.com/x?token=abc");
    const b = crypto.encryptSecret("https://hooks.example.com/x?token=abc");
    assert.notEqual(a, b);
    assert.ok(!a.includes("hooks.example.com"));
    assert.equal(crypto.decryptSecret(a), "https://hooks.example.com/x?token=abc");
  });
  it("篡改密文或更换 AUTH_SECRET 后解密失败", () => {
    const enc = crypto.encryptSecret("secret-value");
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff;
    assert.throws(() => crypto.decryptSecret([parts[0], parts[1], parts[2], ct.toString("base64url")].join(":")));
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-value-for-test-0123456789";
    try {
      assert.throws(() => crypto.decryptSecret(enc));
    } finally {
      process.env.AUTH_SECRET = prev;
    }
    assert.equal(crypto.decryptSecret(enc), "secret-value");
  });
});

describe("入站 Token", () => {
  it("生成高熵 Token，仅保存 SHA-256 与前缀", () => {
    const t = crypto.generateInboundToken();
    assert.match(t.token, /^whsec_[A-Za-z0-9_-]{43}$/);
    assert.match(t.hash, /^[0-9a-f]{64}$/);
    assert.ok(t.token.startsWith(t.prefix) && t.prefix.length === 12);
    assert.notEqual(crypto.generateInboundToken().token, t.token);
  });
  it("校验使用哈希比较，拒绝错误、截断与空 Token", () => {
    const t = crypto.generateInboundToken();
    assert.equal(crypto.verifyInboundToken(t.token, t.hash), true);
    assert.equal(crypto.verifyInboundToken(t.token.slice(0, -1), t.hash), false);
    assert.equal(crypto.verifyInboundToken(t.token + "x", t.hash), false);
    assert.equal(crypto.verifyInboundToken("", t.hash), false);
    assert.equal(crypto.verifyInboundToken(null, t.hash), false);
    assert.equal(crypto.verifyInboundToken(t.token, "not-a-hash"), false);
  });
  it("解析 Bearer 头", () => {
    assert.equal(crypto.parseBearer("Bearer abc"), "abc");
    assert.equal(crypto.parseBearer("bearer abc "), "abc");
    assert.equal(crypto.parseBearer("Basic abc"), null);
    assert.equal(crypto.parseBearer(null), null);
  });
  it("机器人密码哈希永远无法通过 bcrypt 校验", async () => {
    assert.equal(await bcrypt.compare("", BOT_PASSWORD_HASH), false);
    assert.equal(await bcrypt.compare("123456", BOT_PASSWORD_HASH), false);
    assert.equal(await bcrypt.compare(BOT_PASSWORD_HASH, BOT_PASSWORD_HASH), false);
  });
});

describe("出站签名", () => {
  it("X-OA-Signature = sha256=HMAC-SHA256(secret, body)", () => {
    const body = JSON.stringify({ event: "webhook.ping" });
    const expected = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    assert.equal(crypto.signPayload("s3cret", body), expected);
  });
});

describe("Outbound URL 校验（SSRF）", () => {
  const strict = { allowPrivate: false };
  const blocked = [
    "http://127.0.0.1:3000/hook",
    "http://localhost/hook",
    "http://foo.localhost/hook",
    "http://10.1.2.3/",
    "http://172.16.5.4/",
    "http://172.31.255.255/",
    "http://192.168.1.10/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[fd00:ec2::254]/",
    "http://[fe80::1]/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://printer.local/",
  ];
  for (const url of blocked) {
    it(`拦截 ${url}`, () => assert.throws(() => crypto.validateOutboundUrl(url, strict), /内网|环回|元数据/));
  }
  it("拒绝非 http(s) 协议与内嵌账号密码", () => {
    assert.throws(() => crypto.validateOutboundUrl("ftp://example.com/", strict), /http/);
    assert.throws(() => crypto.validateOutboundUrl("file:///etc/passwd", strict), /http/);
    assert.throws(() => crypto.validateOutboundUrl("javascript:alert(1)", strict), /http/);
    assert.throws(() => crypto.validateOutboundUrl("https://u:p@example.com/", strict), /账号密码/);
    assert.throws(() => crypto.validateOutboundUrl("not a url", strict), /格式/);
  });
  it("允许公网地址", () => {
    assert.equal(crypto.validateOutboundUrl("https://hooks.example.com/orca", strict), "https://hooks.example.com/orca");
    assert.equal(crypto.validateOutboundUrl("http://8.8.8.8/x", strict), "http://8.8.8.8/x");
    assert.equal(crypto.validateOutboundUrl("http://[2606:4700::1111]/", strict), "http://[2606:4700::1111]/");
  });
  it("allowPrivate 或 WEBHOOK_ALLOW_PRIVATE_NETWORK=true 时放行 localhost", () => {
    assert.equal(crypto.validateOutboundUrl("http://127.0.0.1:7777/hook", { allowPrivate: true }), "http://127.0.0.1:7777/hook");
    const env = process.env as Record<string, string | undefined>;
    const prev = { node: env.NODE_ENV, allow: env.WEBHOOK_ALLOW_PRIVATE_NETWORK };
    try {
      env.NODE_ENV = "production";
      delete env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
      assert.equal(crypto.allowPrivateNetwork(), false);
      assert.throws(() => crypto.validateOutboundUrl("http://localhost:7777/"));
      env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "true";
      assert.equal(crypto.allowPrivateNetwork(), true);
      assert.equal(crypto.validateOutboundUrl("http://localhost:7777/"), "http://localhost:7777/");
      env.NODE_ENV = "development";
      delete env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
      assert.equal(crypto.allowPrivateNetwork(), true);
    } finally {
      env.NODE_ENV = prev.node;
      if (prev.allow === undefined) delete env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
      else env.WEBHOOK_ALLOW_PRIVATE_NETWORK = prev.allow;
    }
  });
  it("发送前的二次校验同样拦截字面量内网地址", async () => {
    await assert.rejects(() => crypto.assertResolvedPublic("http://169.254.169.254/", strict), /内网|元数据/);
    await assert.doesNotReject(() => crypto.assertResolvedPublic("http://8.8.8.8/", strict));
  });
  it("URL 脱敏只保留协议与主机", () => {
    assert.equal(crypto.maskUrl("https://hooks.example.com/secret/path?token=abc"), "https://hooks.example.com/…");
  });
});

describe("自定义 Header", () => {
  it("解析合法 JSON 并拒绝系统保留与注入", () => {
    assert.deepEqual(crypto.parseHeadersJson('{"Authorization":"Bearer x"}'), { Authorization: "Bearer x" });
    assert.deepEqual(crypto.parseHeadersJson(""), {});
    assert.throws(() => crypto.parseHeadersJson("[1]"));
    assert.throws(() => crypto.parseHeadersJson('{"Host":"evil"}'));
    assert.throws(() => crypto.parseHeadersJson('{"X-OA-Signature":"x"}'));
    assert.throws(() => crypto.parseHeadersJson('{"A":"x\\r\\nB: y"}'));
    assert.throws(() => crypto.parseHeadersJson('{"bad name":"x"}'));
  });
});
