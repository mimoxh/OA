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
      env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "false";
      assert.equal(crypto.allowPrivateNetwork(), false);
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

describe("Outbound URL 云元数据硬拦截", () => {
  const open = { allowPrivate: true };
  const metadata = [
    "http://169.254.169.254/latest/meta-data/",
    "http://2852039166/",
    "http://[::ffff:169.254.169.254]/",
    "http://[fd00:ec2::254]/",
    "http://metadata/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://METADATA.GOOG./",
  ];
  for (const url of metadata) {
    it(`放行内网时仍拦截 ${url}`, () => {
      assert.throws(() => crypto.validateOutboundUrl(url, open), /云元数据/);
      assert.throws(() => crypto.validateOutboundUrl(url, { allowPrivate: false, allowedHosts: [new URL(url).hostname] }), /云元数据/);
    });
  }
  it("放行内网时其余链路本地 / 唯一本地地址不受影响", () => {
    assert.equal(crypto.validateOutboundUrl("http://169.254.1.1/", open), "http://169.254.1.1/");
    assert.equal(crypto.validateOutboundUrl("http://[fd00::1]/", open), "http://[fd00::1]/");
  });
  it("域名解析到元数据地址时，即使放行内网也拦截", async () => {
    const resolve = async () => [{ address: "169.254.169.254", family: 4 }];
    await assert.rejects(() => crypto.assertResolvedPublic("http://rebind.example.com/", { allowPrivate: true, resolve }), /云元数据地址 169\.254\.169\.254/);
    const v6 = async () => [{ address: "fd00:ec2::254", family: 6 }];
    await assert.rejects(() => crypto.assertResolvedPublic("http://rebind.example.com/", { allowPrivate: true, resolve: v6 }), /云元数据/);
  });
});

describe("Outbound URL DNS 二次校验", () => {
  const strict = { allowPrivate: false, allowedHosts: [] as string[] };
  const fixed = (...ips: string[]) => async () => ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("严格模式下解析到 FakeIP 时报错列出命中 IP 并给出放行方式", async () => {
    await assert.rejects(
      () => crypto.assertResolvedPublic("https://hooks.example.com/x", { ...strict, resolve: fixed("198.18.0.42") }),
      (e: Error) => {
        assert.match(e.message, /解析到内网地址，已拦截/);
        assert.match(e.message, /hooks\.example\.com → 198\.18\.0\.42/);
        assert.match(e.message, /FakeIP/);
        assert.match(e.message, /WEBHOOK_ALLOW_PRIVATE_NETWORK=true/);
        assert.match(e.message, /WEBHOOK_ALLOWED_HOSTS/);
        return true;
      },
    );
  });
  it("严格模式下解析到私网地址时列出全部命中 IP，不误报 FakeIP", async () => {
    await assert.rejects(
      () => crypto.assertResolvedPublic("https://bot.corp.example/", { ...strict, resolve: fixed("8.8.8.8", "192.168.1.20", "::ffff:10.0.0.5") }),
      (e: Error) => {
        assert.match(e.message, /192\.168\.1\.20, ::ffff:10\.0\.0\.5/);
        assert.doesNotMatch(e.message, /8\.8\.8\.8/);
        assert.doesNotMatch(e.message, /FakeIP/);
        return true;
      },
    );
  });
  it("严格模式下公网解析放行，空结果与解析失败拦截", async () => {
    await assert.doesNotReject(() => crypto.assertResolvedPublic("https://hooks.example.com/", { ...strict, resolve: fixed("93.184.216.34", "2606:4700::1111") }));
    await assert.rejects(() => crypto.assertResolvedPublic("https://hooks.example.com/", { ...strict, resolve: fixed() }), /未解析到任何地址/);
    const fail = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    await assert.rejects(() => crypto.assertResolvedPublic("https://nx.example.com/", { ...strict, resolve: fail }), /DNS 解析失败（ENOTFOUND）/);
    await assert.doesNotReject(() => crypto.assertResolvedPublic("https://nx.example.com/", { allowPrivate: true, resolve: fail }));
  });
  it("放行内网时 FakeIP / 私网解析结果通过", async () => {
    await assert.doesNotReject(() => crypto.assertResolvedPublic("https://hooks.example.com/", { allowPrivate: true, resolve: fixed("198.18.0.42") }));
    await assert.doesNotReject(() => crypto.assertResolvedPublic("http://bot.lan.example/", { allowPrivate: true, resolve: fixed("192.168.1.20") }));
  });
  it("未传 allowPrivate 时按环境变量：生产默认拦截、显式 true 放行", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = { node: env.NODE_ENV, allow: env.WEBHOOK_ALLOW_PRIVATE_NETWORK, hosts: env.WEBHOOK_ALLOWED_HOSTS };
    const resolve = fixed("198.18.0.42");
    try {
      env.NODE_ENV = "production";
      delete env.WEBHOOK_ALLOW_PRIVATE_NETWORK;
      delete env.WEBHOOK_ALLOWED_HOSTS;
      await assert.rejects(() => crypto.assertResolvedPublic("https://hooks.example.com/", { resolve }), /FakeIP/);
      env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "true";
      await assert.doesNotReject(() => crypto.assertResolvedPublic("https://hooks.example.com/", { resolve }));
      env.WEBHOOK_ALLOW_PRIVATE_NETWORK = "false";
      env.WEBHOOK_ALLOWED_HOSTS = " Hooks.Example.com , *.lan.example ";
      await assert.doesNotReject(() => crypto.assertResolvedPublic("https://hooks.example.com/", { resolve }));
      await assert.doesNotReject(() => crypto.assertResolvedPublic("http://a.b.lan.example/", { resolve }));
      await assert.rejects(() => crypto.assertResolvedPublic("https://other.example.com/", { resolve }), /FakeIP/);
    } finally {
      for (const [k, v] of [["NODE_ENV", prev.node], ["WEBHOOK_ALLOW_PRIVATE_NETWORK", prev.allow], ["WEBHOOK_ALLOWED_HOSTS", prev.hosts]] as const) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    }
  });
});

describe("WEBHOOK_ALLOWED_HOSTS 白名单", () => {
  it("解析逗号分隔、忽略空项并统一小写", () => {
    assert.deepEqual(crypto.allowedHostPatterns(" Bot.LAN , ,*.Example.com.,[::1] "), ["bot.lan", "*.example.com", "::1"]);
    assert.deepEqual(crypto.allowedHostPatterns(undefined), []);
  });
  it("精确匹配与 *. 子域名通配", () => {
    const p = ["bot.lan", "*.example.com", "192.168.1.20", "::1"];
    assert.equal(crypto.isAllowedHost("BOT.lan.", p), true);
    assert.equal(crypto.isAllowedHost("a.example.com", p), true);
    assert.equal(crypto.isAllowedHost("a.b.example.com", p), true);
    assert.equal(crypto.isAllowedHost("example.com", p), false);
    assert.equal(crypto.isAllowedHost("evilexample.com", p), false);
    assert.equal(crypto.isAllowedHost("bot.lan.evil.com", p), false);
    assert.equal(crypto.isAllowedHost("192.168.1.20", p), true);
    assert.equal(crypto.isAllowedHost("[::1]", p), true);
  });
  it("严格模式下白名单主机可指向内网，其他主机仍拦截", () => {
    const opts = { allowPrivate: false, allowedHosts: ["printer.local", "192.168.1.20", "::1"] };
    assert.equal(crypto.validateOutboundUrl("http://printer.local/hook", opts), "http://printer.local/hook");
    assert.equal(crypto.validateOutboundUrl("http://192.168.1.20:8080/", opts), "http://192.168.1.20:8080/");
    assert.equal(crypto.validateOutboundUrl("http://[::1]:7777/", opts), "http://[::1]:7777/");
    assert.throws(() => crypto.validateOutboundUrl("http://192.168.1.21/", opts), /内网.*192\.168\.1\.21.*WEBHOOK_ALLOWED_HOSTS/);
    assert.throws(() => crypto.validateOutboundUrl("http://localhost/", opts), /内网/);
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
