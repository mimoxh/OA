import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { SOFT_KEYBOARD_QUERY, keepSoftKeyboardClosed } from "@/components/mobile/use-mobile-layout";

// 手机 / 触屏上打开模型选择面板时不自动聚焦搜索框（否则立即弹出输入法遮住模型列表）
const read = (f: string) => fs.readFileSync(path.resolve(f), "utf8");
const g = globalThis as { window?: unknown };

function openEvent() {
  const calls = { prevented: 0, focused: [] as unknown[] };
  const e = {
    preventDefault: () => calls.prevented++,
    currentTarget: { focus: (opts: unknown) => calls.focused.push(opts) },
  } as unknown as Event;
  return { e, calls };
}

function stubMatchMedia(matches: boolean) {
  const queries: string[] = [];
  g.window = { matchMedia: (q: string) => (queries.push(q), { matches }) };
  return queries;
}

describe("模型选择面板在手机端不自动激活搜索框", () => {
  afterEach(() => {
    delete g.window;
  });

  it("检测条件与手机布局断点一致，并覆盖触屏为主的设备", () => {
    assert.equal(SOFT_KEYBOARD_QUERY, "(width < 48rem), (pointer: coarse)");
  });

  it("手机 / 触屏：阻止 Radix 默认聚焦第一个输入框，改为聚焦面板容器且不滚动", () => {
    const queries = stubMatchMedia(true);
    const { e, calls } = openEvent();
    keepSoftKeyboardClosed(e);
    assert.deepEqual(queries, [SOFT_KEYBOARD_QUERY]);
    assert.equal(calls.prevented, 1);
    assert.deepEqual(calls.focused, [{ preventScroll: true }]);
  });

  it("桌面：保持 Radix 默认行为（聚焦搜索框）", () => {
    stubMatchMedia(false);
    const { e, calls } = openEvent();
    keepSoftKeyboardClosed(e);
    assert.equal(calls.prevented, 0);
    assert.deepEqual(calls.focused, []);
  });

  it("搜索框不使用 autoFocus（会在弹层挂载前抢先聚焦，使 onOpenAutoFocus 不再触发）", () => {
    const src = read("src/components/im/run-options.tsx");
    assert.doesNotMatch(src, /autoFocus(=|\?:|,)/);
    assert.doesNotMatch(src, /^\s*autoFocus\s*$/m);
  });

  it("聊天页配置条与设置页的模型面板都接入 keepSoftKeyboardClosed", () => {
    for (const f of ["src/components/im/webhook-run-config-bar.tsx", "src/components/settings/webhook-bots.tsx"]) {
      const src = read(f);
      const model = (src.match(/<PopoverContent [^>]*>\s*(?:<PanelHeader field="model"[^>]*\/>\s*)?<ModelOptions/g) ?? []);
      assert.equal(model.length, 1, f);
      assert.match(model[0], /onOpenAutoFocus=\{keepSoftKeyboardClosed\}/, f);
      assert.doesNotMatch(src, /<ModelOptions\s+autoFocus/, f);
    }
  });
});
