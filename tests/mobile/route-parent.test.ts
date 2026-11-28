import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parentRoute, parentRoutes, resolveBack, routeKey } from "@/components/mobile/route-parent";

describe("parentRoute（手机端返回 = 退到上一级）", () => {
  it("一级标签页与登录页没有上一级", () => {
    for (const p of ["/messages", "/contacts", "/work", "/me", "/login", "/"]) assert.equal(parentRoutes(p), null, p);
  });

  it("会话 → 消息列表", () => {
    assert.equal(parentRoute("/messages/cmabc"), "/messages");
    assert.equal(parentRoute("/messages/cmabc?jump=12"), "/messages");
  });

  it("审批详情 → 审批列表；审批列表 → 工作台", () => {
    assert.equal(parentRoute("/oa/approvals/a1"), "/oa/approvals");
    assert.equal(parentRoute("/oa/approvals/new"), "/oa/approvals");
    assert.equal(parentRoute("/oa/approvals?tab=done"), "/work");
  });

  it("项目任务 → 项目；项目 → 项目列表；项目列表（模块首页）→ 工作台", () => {
    assert.equal(parentRoute("/pms/projects/p1?task=t1"), "/pms/projects/p1");
    assert.equal(parentRoute("/pms/projects/p1?task=t1&view=list"), "/pms/projects/p1?view=list");
    assert.equal(parentRoute("/pms/projects/p1?view=board"), "/pms");
    assert.equal(parentRoute("/pms"), "/work");
    assert.equal(parentRoute("/pms/my-tasks"), "/work");
  });

  it("模块页 → 工作台；多级详情逐级向上", () => {
    assert.equal(parentRoute("/oa"), "/work");
    assert.equal(parentRoute("/oa/calendar?date=2026-11-27"), "/work");
    assert.equal(parentRoute("/finance/vouchers"), "/work");
    assert.equal(parentRoute("/finance/vouchers/new"), "/finance/vouchers");
    assert.equal(parentRoute("/erp/purchase/po1/edit"), "/erp/purchase/po1");
    assert.equal(parentRoute("/erp/purchase/po1"), "/erp/purchase");
    assert.equal(parentRoute("/wms/warehouses/w1/"), "/wms/warehouses");
    assert.equal(parentRoute("/inbox"), "/work");
    assert.equal(parentRoute("/docs/d1"), "/docs");
    assert.equal(parentRoute("/docs"), "/work");
  });

  it("我的 / 设置", () => {
    assert.equal(parentRoute("/me/notifications"), "/me");
    assert.equal(parentRoute("/me/notifications/guide"), "/me/notifications");
    assert.equal(parentRoute("/settings"), "/me");
    assert.equal(parentRoute("/settings/profile"), "/settings");
  });

  it("模块下的列表页也接受回到模块菜单", () => {
    assert.deepEqual(parentRoutes("/oa/approvals"), ["/work", "/oa"]);
  });

  it("routeKey 只保留决定层级的参数", () => {
    assert.equal(routeKey("/oa/approvals?tab=done"), "/oa/approvals");
    assert.equal(routeKey("/pms/projects/p1?view=list&task=t9"), "/pms/projects/p1?task=t9");
    assert.equal(routeKey("/pms/projects/p1?view=list"), "/pms/projects/p1");
  });
});

describe("resolveBack（返回键 / 顶栏返回 / 页面内返回的统一决策）", () => {
  it("一级页面：退到后台", () => {
    assert.deepEqual(resolveBack("/messages", ["/messages"]), { kind: "exit" });
    assert.deepEqual(resolveBack("/work", ["/messages", "/work"]), { kind: "exit" });
  });

  it("上一页就是上一级：历史后退（保留列表的筛选与滚动）", () => {
    assert.deepEqual(resolveBack("/messages/c1", ["/messages", "/messages/c1"]), { kind: "history" });
    assert.deepEqual(resolveBack("/oa/approvals/a1", ["/work", "/oa/approvals?tab=done", "/oa/approvals/a1"]), { kind: "history" });
    assert.deepEqual(resolveBack("/pms/projects/p1?task=t1", ["/pms", "/pms/projects/p1?view=list", "/pms/projects/p1?view=list&task=t1"]), {
      kind: "history",
    });
    // 从模块菜单进入的列表页回到模块菜单
    assert.deepEqual(resolveBack("/oa/approvals", ["/work", "/oa", "/oa/approvals"]), { kind: "history" });
  });

  it("通知深链直接打开（没有站内上一页）：替换为上一级", () => {
    assert.deepEqual(resolveBack("/messages/c1", ["/messages/c1"]), { kind: "replace", href: "/messages" });
    assert.deepEqual(resolveBack("/oa/approvals/a1", ["/oa/approvals/a1"]), { kind: "replace", href: "/oa/approvals" });
    assert.deepEqual(resolveBack("/pms/projects/p1?task=t1", ["/pms/projects/p1?task=t1"]), { kind: "replace", href: "/pms/projects/p1" });
  });

  it("从别处跳进来（上一页不是上一级）：不回到无关页面", () => {
    // 会话里点开审批卡片 → 返回到审批列表，而不是回到会话
    assert.deepEqual(resolveBack("/oa/approvals/a1", ["/messages", "/messages/c1", "/oa/approvals/a1"]), {
      kind: "replace",
      href: "/oa/approvals",
    });
    // 工作台的「我的任务」直接打开任务：先回项目
    assert.deepEqual(resolveBack("/pms/projects/p1?task=t1", ["/work", "/pms/projects/p1?task=t1"]), { kind: "replace", href: "/pms/projects/p1" });
    // 另一条任务不算上一级
    assert.deepEqual(resolveBack("/pms/projects/p1?task=t2", ["/pms/projects/p1?task=t1", "/pms/projects/p1?task=t2"]), {
      kind: "replace",
      href: "/pms/projects/p1",
    });
  });
});
