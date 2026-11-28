import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// 手机上消息行 = 头像列（w-8 shrink-0）+ gap-2 + 气泡列（min-w-0），整行最多 88%。
// 文件框、业务卡片如果按视口宽度（75vw / 80vw）限宽，窄屏时会比气泡列宽，溢出后盖住右侧自己的头像。
const read = (f: string) => fs.readFileSync(path.resolve(f), "utf8");

describe("聊天消息宽度（手机布局）", () => {
  const item = read("src/components/im/message-item.tsx");

  it("头像列固定 32px 不被压缩，气泡列可以收窄", () => {
    assert.match(item, /<div className="w-8 shrink-0">/);
    assert.match(item, /<div className=\{cn\("min-w-0", mine && "flex flex-col items-end"\)\}>/);
    assert.match(item, /"flex max-w-full gap-2 max-md:max-w-\[88%\]"/);
  });

  it("气泡在手机上不超过气泡列", () => {
    assert.match(item, /"group\/bubble relative w-fit max-w-\[min\(560px,100%\)\][^"]*"/);
    assert.match(item, /"max-md:max-w-full",\r?\n\s+mine \?/);
  });

  it("文件消息框在手机上跟随气泡宽度，文件名单行截断", () => {
    assert.match(item, /"flex w-\[280px\] max-w-\[75vw\] [^"]*max-md:max-w-full"/);
    assert.match(item, /<span className="min-w-0 flex-1">\s*<span className="block truncate[^"]*">\{file\.filename\}/);
    assert.match(item, /<Eye className="size-4 shrink-0[^"]*" \/> : <Download className="size-4 shrink-0/);
  });

  it("业务卡片（审批 / 任务等）在手机上跟随气泡宽度", () => {
    assert.match(read("src/components/im/card-view.tsx"), /"w-\[320px\] max-w-\[80vw\] overflow-hidden [^"]*max-md:max-w-full"/);
  });

  it("引用预览卡片不超过气泡宽度", () => {
    const ref = read("src/components/im/ref-preview.tsx");
    assert.match(ref, /mt-1 block w-80 max-w-full/);
    assert.equal((ref.match(/w-72 max-w-full/g) ?? []).length, 2);
  });
});
