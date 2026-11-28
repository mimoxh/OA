import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { moduleSubPages, NAV_MODULES } from "@/lib/nav";
import { parentRoutes, resolveBack } from "@/components/mobile/route-parent";

const WORK_APPS = ["oa", "crm", "erp", "finance", "wms", "tms"];

describe("moduleSubPages（手机模块首页的子页面入口）", () => {
  it("不含模块首页本身", () => {
    for (const key of WORK_APPS) {
      const mod = NAV_MODULES.find((m) => m.key === key)!;
      const items = moduleSubPages(key, ["admin"]);
      assert.ok(items.length > 0, key);
      assert.ok(items.every((i) => i.href !== mod.href && i.href.startsWith(mod.href + "/")), key);
    }
  });

  it("按权限过滤：没有 oa:edit 看不到流程管理", () => {
    assert.deepEqual(
      moduleSubPages("oa", ["oa:view"]).map((i) => i.href),
      ["/oa/approvals", "/oa/announcements", "/oa/calendar"],
    );
    assert.ok(moduleSubPages("oa", ["oa:edit"]).some((i) => i.href === "/oa/flows"));
  });

  it("未知模块返回空", () => {
    assert.deepEqual(moduleSubPages("nope", ["admin"]), []);
  });
});

describe("模块首页入口 → 列表页的返回", () => {
  it("每个子页面默认回工作台，也接受回到模块首页", () => {
    for (const key of WORK_APPS) {
      const mod = NAV_MODULES.find((m) => m.key === key)!;
      for (const i of moduleSubPages(key, ["admin"])) assert.deepEqual(parentRoutes(i.href), ["/work", mod.href], i.href);
    }
  });

  it("从模块首页入口进入的列表页，返回时历史后退回模块首页", () => {
    assert.deepEqual(resolveBack("/crm/customers", ["/work", "/crm", "/crm/customers"]), { kind: "history" });
    assert.deepEqual(resolveBack("/wms/inventory?low=1", ["/work", "/wms", "/wms/inventory?low=1"]), { kind: "history" });
    // 从工作台直接进入：回工作台
    assert.deepEqual(resolveBack("/oa/approvals", ["/work", "/oa/approvals"]), { kind: "history" });
    // 深链直接打开：替换为工作台
    assert.deepEqual(resolveBack("/tms/orders", ["/tms/orders"]), { kind: "replace", href: "/work" });
  });

  it("模块首页本身回工作台", () => {
    for (const key of WORK_APPS) assert.deepEqual(parentRoutes(NAV_MODULES.find((m) => m.key === key)!.href), ["/work"]);
  });
});
