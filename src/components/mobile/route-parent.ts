/**
 * 手机端「返回」= 退到上一级页面（不是浏览器历史后退）。所有返回入口（Android 返回键、顶栏返回、页面内返回）共用这里的层级表。
 *
 *   会话 /messages/:id → 消息列表；审批详情 → 审批列表；项目任务（?task=）→ 项目；项目 → 项目列表；
 *   模块页（模块首页 / 模块下的列表页）→ 工作台；/me/* → 我的；一级标签页 → 退到后台（null）。
 */
export const TAB_ROOTS = ["/messages", "/contacts", "/work", "/me"] as const;

export function isTabRoot(pathname: string) {
  return (TAB_ROOTS as readonly string[]).includes(pathname);
}

/** 业务模块首页（手机上是模块概览 + 子页面入口宫格） */
const MODULE_ROOTS = ["/oa", "/crm", "/erp", "/finance", "/wms", "/tms", "/pms", "/docs"];

/** 层级不是“去掉最后一段”的页面 */
const SPECIAL: [pattern: RegExp, parents: string[]][] = [
  [/^\/messages\/[^/]+$/, ["/messages"]],
  [/^\/me\/notifications\/guide$/, ["/me/notifications"]],
  [/^\/me\/.+$/, ["/me"]],
  [/^\/settings$/, ["/me"]],
  [/^\/settings\/[^/]+$/, ["/settings", "/me"]],
  [/^\/inbox$/, ["/work"]],
  [/^\/pms\/projects$/, ["/pms"]],
  [/^\/pms\/projects\/[^/]+$/, ["/pms", "/work"]],
  [/^\/docs\/(trash|graph)$/, ["/docs"]],
  [/^\/docs\/[^/]+$/, ["/docs", "/work"]],
];

function split(href: string): { path: string; params: URLSearchParams } {
  const i = href.indexOf("?");
  const raw = i < 0 ? href : href.slice(0, i);
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  return { path: path || "/", params: new URLSearchParams(i < 0 ? "" : href.slice(i + 1)) };
}

/**
 * 可接受的上一级页面，第一个是默认去处。返回 null 表示已是一级页面（App 内退到后台）。
 * 模块下的列表页默认回工作台；如果是从模块首页的入口进来的，也接受回到模块首页。
 */
export function parentRoutes(href: string): string[] | null {
  const { path, params } = split(href);
  if (path === "/login" || path === "/" || isTabRoot(path)) return null;
  const task = params.get("task");
  if (task && /^\/pms\/projects\/[^/]+$/.test(path)) {
    // 回到项目时保留视图等参数
    params.delete("task");
    const qs = params.toString();
    return [qs ? `${path}?${qs}` : path];
  }
  for (const [re, parents] of SPECIAL) if (re.test(path)) return parents;
  if (MODULE_ROOTS.includes(path)) return ["/work"];
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 2 && MODULE_ROOTS.includes(`/${segs[0]}`)) return ["/work", `/${segs[0]}`];
  if (segs.length > 2) {
    // 详情 / 新建 / 编辑：/erp/purchase/:id/edit → /erp/purchase/:id；/oa/approvals/:id → /oa/approvals
    return [`/${segs.slice(0, -1).join("/")}`];
  }
  return ["/work"];
}

/** 默认的上一级页面 */
export function parentRoute(href: string): string | null {
  return parentRoutes(href)?.[0] ?? null;
}

/** 导航记录里用来比较“是不是同一页”的键：路径 + 决定页面层级的参数（项目任务的 task） */
export function routeKey(href: string): string {
  const { path, params } = split(href);
  const task = params.get("task");
  return task && /^\/pms\/projects\/[^/]+$/.test(path) ? `${path}?task=${task}` : path;
}

export type BackAction = { kind: "exit" } | { kind: "history" } | { kind: "replace"; href: string };

/**
 * 返回该怎么做：
 * - 一级页面 → exit（App 退到后台；浏览器里不处理）；
 * - 记录里的上一页正好是可接受的上一级 → history（router.back，保留上一级的滚动位置与筛选参数）；
 * - 其他情况（从通知深链进入、从别的模块跳过来）→ replace 到默认上一级，不回到无关页面。
 */
export function resolveBack(current: string, stack: readonly string[]): BackAction {
  const parents = parentRoutes(current);
  if (!parents) return { kind: "exit" };
  const prev = stack.length > 1 ? stack[stack.length - 2] : null;
  if (prev && parents.some((p) => routeKey(p) === routeKey(prev))) return { kind: "history" };
  return { kind: "replace", href: parents[0] };
}
