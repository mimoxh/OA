import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Webhook 机器人的基座 / 模型 / 思考强度放在圆角输入框正上方，输入框内只留工具图标和「发送」
const read = (f: string) => fs.readFileSync(path.resolve(f), "utf8");

describe("Webhook 运行配置条与输入框排版", () => {
  const composer = read("src/components/im/composer.tsx");
  const chat = read("src/components/im/chat-view.tsx");
  const bar = read("src/components/im/webhook-run-config-bar.tsx");

  it("配置条通过 topBar 渲染在圆角输入框之前（外部），不再进入输入框工具栏", () => {
    assert.match(chat, /topBar=\{\s*runConfig && runBots\.length > 0 \? \(\s*<WebhookRunConfigBar /);
    assert.doesNotMatch(chat, /toolbar=/);
    assert.doesNotMatch(composer, /\{toolbar\}/);
    const top = composer.indexOf("{topBar && (");
    const box = composer.indexOf('"rounded-lg border transition-colors');
    assert.ok(top > 0 && box > top, "topBar 应在圆角输入框之前");
  });

  it("配置条窄屏时横向滚动、隐藏滚动条，不撑宽整页", () => {
    assert.match(composer, /className="[^"]*min-w-0[^"]*overflow-x-auto[^"]*\[scrollbar-width:none\] \[&::-webkit-scrollbar\]:hidden" data-composer-top-bar/);
  });

  it("输入框内工具图标与「发送」固定在同一行，不折行", () => {
    assert.match(composer, /<div className="flex items-center justify-between gap-2 px-2 pb-1\.5">/);
    assert.doesNotMatch(composer, /flex-wrap/);
  });

  it("没有配置条时（真人聊天、话题回复）不渲染额外的容器", () => {
    assert.match(composer, /\{topBar && \(/);
    assert.doesNotMatch(read("src/components/im/thread-drawer.tsx"), /topBar=/);
  });

  it("胶囊：只压缩模型 ID，基座和强度保持完整", () => {
    assert.match(bar, /field === "model" \? "shrink" : field === "agent" \? "max-w-32 shrink-0" : "shrink-0"/);
  });

  it("三个弹层都从配置条向上展开、左对齐，避让屏幕边缘与状态栏，超高时内部滚动", () => {
    const pops = bar.match(/<PopoverContent [^>]*>/g) ?? [];
    assert.equal(pops.length, 3);
    for (const p of pops) {
      assert.match(p, /side="top" align="start" collisionPadding=\{padding\}/);
      assert.match(p, /POPOVER_FIT/);
    }
    assert.match(bar, /POPOVER_FIT = "max-h-\(--radix-popover-content-available-height\) max-w-\[calc\(100vw-16px\)\] overflow-y-auto"/);
    assert.match(bar, /getComputedStyle\(document\.body\)\.paddingTop/);
  });
});
