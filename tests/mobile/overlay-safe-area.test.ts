import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// 手机上盖住整屏的浮层要自己让出状态栏（--sat）和系统导航栏（--sab）：body 的 padding-top 对 fixed 元素无效
const read = (f: string) => fs.readFileSync(path.resolve(f), "utf8");

describe("全屏浮层的安全区（手机布局）", () => {
  it("通话界面：顶部让出状态栏、底部控制栏让出导航栏、来电与最小化浮窗不进系统栏", () => {
    const src = read("src/components/call/call-overlay.tsx");
    assert.match(src, /top-app z-50 flex flex-col[^"]*max-md:top-0 max-md:pt-\[var\(--sat\)\]/);
    assert.match(src, /<footer className="[^"]*max-md:pb-\[calc\(var\(--sab\)\+0\.75rem\)\]/);
    assert.match(src, /w-\[330px\][^"]*max-md:top-\[calc\(var\(--sat\)\+0\.75rem\)\]/);
    assert.match(src, /fixed bottom-5 right-5[^"]*max-md:bottom-auto[^"]*max-md:top-\[calc\(var\(--sat\)\+6\.75rem\)\]/);
  });

  it("日程详情：手机上「拒绝」「接受」单独一行、等宽，不和会议按钮挤在一起折行", () => {
    const src = read("src/app/(app)/oa/calendar/event-dialog.tsx");
    assert.match(src, /mine && "max-md:w-full"/);
    assert.match(src, /className="[^"]*max-md:w-full max-md:\[&>button\]:h-10 max-md:\[&>button\]:flex-1" data-event-response/);
  });

  it("文档评论面板与数据表记录抽屉", () => {
    assert.match(read("src/components/docs/comments-panel.tsx"), /max-lg:fixed[^"]*max-md:top-0[^"]*max-md:pt-\[var\(--sat\)\] max-md:pb-\[var\(--sab\)\]/);
    const drawer = read("src/components/docs/database/row-drawer.tsx");
    assert.match(drawer, /top-app z-50 flex justify-end max-md:top-0/);
    assert.match(drawer, /<aside className="[^"]*max-md:pt-\[var\(--sat\)\] max-md:pb-\[var\(--sab\)\]/);
  });
});
