import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { meLinks } from "@/app/(app)/me/me-links";

describe("meLinks（手机「我的」页入口）", () => {
  it("普通成员只有个人资料，不含收件箱", () => {
    const links = meLinks({ isAdmin: false });
    assert.deepEqual(links.map((l) => l.label), ["个人资料"]);
    assert.ok(!links.some((l) => l.href.startsWith("/inbox") || l.label.includes("收件箱")));
  });

  it("管理员多一个管理后台，同样不含收件箱", () => {
    const links = meLinks({ isAdmin: true });
    assert.deepEqual(links.map((l) => l.href), ["/settings/profile", "/settings/members"]);
    assert.ok(!links.some((l) => l.href.startsWith("/inbox") || l.label.includes("收件箱")));
  });
});
