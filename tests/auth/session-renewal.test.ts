import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeJwt } from "jose";
import { NextRequest } from "next/server";

import {
  MOBILE_SESSION_MAX_AGE_SECONDS,
  MOBILE_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  renewSessionToken,
  sessionTtlFor,
  signScopedToken,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth/token";
import { isMobileUserAgent } from "@/lib/mobile-ua";
import { proxy } from "@/proxy";

// 密钥在签名时才读取，导入之后设置即可
process.env.AUTH_SECRET ??= "test-secret-for-session-renewal-tests-0123456789";

const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

function request(token: string | null, { method = "GET", path = "/messages" } = {}) {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  return new NextRequest(`http://localhost:3000${path}`, { method, headers });
}

describe("会话有效期", () => {
  it("手机 App 30 天，浏览器/桌面 7 天", () => {
    assert.equal(sessionTtlFor("mobile"), 30 * DAY);
    assert.equal(sessionTtlFor("web"), 7 * DAY);
    assert.equal(sessionTtlFor(undefined), SESSION_TTL_SECONDS);
  });

  it("按 UA 标记识别手机 App", () => {
    assert.equal(isMobileUserAgent("Mozilla/5.0 (Linux; Android 16) Chrome/133 Mobile Safari/537.36 OAMobile/0.1.0"), true);
    assert.equal(isMobileUserAgent("Mozilla/5.0 (Linux; Android 16) Chrome/133 Mobile Safari/537.36"), false);
    assert.equal(isMobileUserAgent(null), false);
  });

  it("客户端类型与登录时间写入令牌", async () => {
    const t = await signSessionToken({ userId: "u1", client: "mobile" });
    const s = await verifySessionToken(t);
    assert.equal(s?.client, "mobile");
    assert.equal(s?.userId, "u1");
    assert.ok(s?.authTime && Math.abs(s.authTime - now()) <= 2);
    assert.equal((s!.exp ?? 0) - (s!.iat ?? 0), MOBILE_SESSION_TTL_SECONDS);
    const w = await verifySessionToken(await signSessionToken({ userId: "u1" }));
    assert.equal(w?.client, "web");
  });

  it("带 scope 的令牌不能充当会话", async () => {
    assert.equal(await verifySessionToken(await signScopedToken("rt", "u1", 60)), null);
  });
});

describe("滑动续期（renewSessionToken）", () => {
  it("手机会话签发超过 1 天后换发 30 天新令牌，保留登录时间", async () => {
    const t0 = now();
    const login = t0 - 10 * DAY;
    const token = await signSessionToken({ userId: "u1", client: "mobile", authTime: login }, MOBILE_SESSION_TTL_SECONDS, t0 - 2 * DAY);
    const s = (await verifySessionToken(token))!;
    const r = await renewSessionToken(s, t0);
    assert.ok(r);
    assert.equal(r.maxAge, MOBILE_SESSION_TTL_SECONDS);
    const next = (await verifySessionToken(r.token))!;
    assert.equal(next.client, "mobile");
    assert.equal(next.authTime, login);
    assert.equal(next.iat, t0);
    assert.equal(next.exp, t0 + MOBILE_SESSION_TTL_SECONDS);
  });

  it("签发不足 1 天不续期", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "mobile" }, MOBILE_SESSION_TTL_SECONDS, t0 - 3600);
    assert.equal(await renewSessionToken((await verifySessionToken(token))!, t0), null);
  });

  it("浏览器/桌面会话从不续期", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "web" }, SESSION_TTL_SECONDS, t0 - 5 * DAY);
    assert.equal(await renewSessionToken((await verifySessionToken(token))!, t0), null);
  });

  it("旧版令牌（没有客户端类型与登录时间）不续期", async () => {
    assert.equal(await renewSessionToken({ userId: "u1", client: "web", authTime: null, iat: now() - 5 * DAY, exp: now() + DAY }), null);
    assert.equal(await renewSessionToken({ userId: "u1", client: "mobile", authTime: null, iat: now() - 5 * DAY, exp: now() + DAY }), null);
  });

  it("新令牌到期时间不超过登录后 180 天，临近上限时停止换发", async () => {
    const t0 = now();
    const near = { userId: "u1", client: "mobile" as const, authTime: t0 - MOBILE_SESSION_MAX_AGE_SECONDS + 5 * DAY, iat: t0 - 2 * DAY, exp: t0 + 28 * DAY };
    // exp 已经比 "登录 + 180 天" 更晚时不再换发（不会延长）
    assert.equal(await renewSessionToken(near, t0), null);
    const capped = await renewSessionToken({ ...near, exp: t0 + 2 * DAY }, t0);
    assert.ok(capped);
    assert.equal(capped.maxAge, 5 * DAY);
    const s = (await verifySessionToken(capped.token))!;
    assert.equal(s.exp, near.authTime + MOBILE_SESSION_MAX_AGE_SECONDS);
    const last = { ...near, authTime: t0 - MOBILE_SESSION_MAX_AGE_SECONDS + DAY / 2, exp: t0 + DAY / 4 };
    assert.equal(await renewSessionToken(last, t0), null);
  });
});

describe("proxy 中的续期", () => {
  it("手机会话 GET 请求写回续期 Cookie", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "mobile", authTime: t0 - 3 * DAY }, MOBILE_SESSION_TTL_SECONDS, t0 - 2 * DAY);
    const res = await proxy(request(token));
    const c = res.cookies.get(SESSION_COOKIE);
    assert.ok(c, "应写回会话 Cookie");
    assert.notEqual(c.value, token);
    assert.equal(c.httpOnly, true);
    assert.equal(c.sameSite, "lax");
    assert.equal(c.path, "/");
    assert.equal(c.maxAge, MOBILE_SESSION_TTL_SECONDS);
    const s = await verifySessionToken(c.value);
    assert.equal(s?.userId, "u1");
    assert.equal(s?.client, "mobile");
  });

  it("API 的 GET 请求同样续期（App 在前台时轮询/补拉即可保持登录）", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "mobile" }, MOBILE_SESSION_TTL_SECONDS, t0 - 2 * DAY);
    const res = await proxy(request(token, { path: "/api/im/conversations" }));
    assert.ok(res.cookies.get(SESSION_COOKIE));
  });

  it("POST（Server Action）不续期，避免覆盖登录/退出写入的 Cookie", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "mobile" }, MOBILE_SESSION_TTL_SECONDS, t0 - 2 * DAY);
    const res = await proxy(request(token, { method: "POST" }));
    assert.equal(res.cookies.get(SESSION_COOKIE), undefined);
  });

  it("浏览器会话不续期", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "web" }, SESSION_TTL_SECONDS, t0 - 5 * DAY);
    const res = await proxy(request(token));
    assert.equal(res.cookies.get(SESSION_COOKIE), undefined);
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });

  it("超过 30 天没有访问的手机会话已过期：页面跳登录、接口 401", async () => {
    const t0 = now();
    const token = await signSessionToken({ userId: "u1", client: "mobile" }, MOBILE_SESSION_TTL_SECONDS, t0 - 31 * DAY);
    const page = await proxy(request(token));
    assert.equal(page.status, 307);
    assert.match(page.headers.get("location") ?? "", /\/login\?next=%2Fmessages/);
    const api = await proxy(request(token, { path: "/api/im/conversations" }));
    assert.equal(api.status, 401);
  });

  it("连续使用时每次续期都把到期时间往后推", async () => {
    // 模拟 60 天里每隔 20 天打开一次 App（单张令牌只有 30 天）；历史时刻的令牌按真实时钟已过期，这里直接解码载荷
    const asSession = (token: string) => {
      const p = decodeJwt(token);
      return { userId: String(p.userId), client: p.cl === "m" ? ("mobile" as const) : ("web" as const), authTime: p.at as number, iat: p.iat!, exp: p.exp! };
    };
    let t = now() - 60 * DAY;
    let token = await signSessionToken({ userId: "u1", client: "mobile", authTime: t }, MOBILE_SESSION_TTL_SECONDS, t);
    for (let i = 0; i < 3; i++) {
      t += 20 * DAY;
      const s = asSession(token);
      assert.ok(s.exp > t, `第 ${i + 1} 次打开时旧令牌仍在有效期内`);
      const r = await renewSessionToken(s, t);
      assert.ok(r, `第 ${i + 1} 次续期`);
      token = r.token;
    }
    const s = (await verifySessionToken(token))!;
    assert.ok(s, "最后一张令牌按真实时钟有效");
    assert.ok(s.exp! > now() + 25 * DAY);
  });
});
