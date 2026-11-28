import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commentPlaceholder } from "@/lib/pms/utils";

describe("commentPlaceholder（任务评论框提示）", () => {
  it("手机：简短，不提键盘快捷键", () => {
    assert.equal(commentPlaceholder(true), "输入评论…");
    assert.ok(!commentPlaceholder(true).includes("Ctrl"));
  });
  it("桌面：保持原文案", () => {
    assert.equal(commentPlaceholder(false), "写评论，输入 @ 提及成员，Ctrl + Enter 发送");
  });
});
