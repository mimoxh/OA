import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countsForPresence,
  DESKTOP_ACTIVE_MS,
  isActiveOnDesktop,
  parseClientKind,
  shouldSendToClient,
} from "@/lib/push/realtime-filter";

describe("实时连接分类", () => {
  it("识别 ?client= 参数，缺省或未知为 web", () => {
    assert.equal(parseClientKind("bg"), "bg");
    assert.equal(parseClientKind("app"), "app");
    assert.equal(parseClientKind(null), "web");
    assert.equal(parseClientKind("BG"), "web");
  });

  it("后台连接不计入在线状态", () => {
    assert.equal(countsForPresence("bg"), false);
    assert.equal(countsForPresence("app"), true);
    assert.equal(countsForPresence("web"), true);
  });

  it("push.* 只发给手机（后台连接与 App 页面），其他事件不发给后台连接", () => {
    assert.equal(shouldSendToClient("bg", "push.notify"), true);
    assert.equal(shouldSendToClient("app", "push.clear"), true);
    assert.equal(shouldSendToClient("web", "push.notify"), false);
    assert.equal(shouldSendToClient("bg", "message.new"), false);
    assert.equal(shouldSendToClient("bg", "typing"), false);
    assert.equal(shouldSendToClient("app", "message.new"), true);
    assert.equal(shouldSendToClient("web", "presence"), true);
  });

  it("电脑端活跃判断：只看 web 连接、在有效期内", () => {
    const now = 1_000_000_000;
    assert.equal(isActiveOnDesktop([{ kind: "web", activeAt: now - 1000 }], now), true);
    assert.equal(isActiveOnDesktop([{ kind: "web", activeAt: now - DESKTOP_ACTIVE_MS - 1 }], now), false);
    assert.equal(isActiveOnDesktop([{ kind: "web", activeAt: 0 }], now), false);
    assert.equal(isActiveOnDesktop([{ kind: "app", activeAt: now }, { kind: "bg", activeAt: now }], now), false);
  });
});
