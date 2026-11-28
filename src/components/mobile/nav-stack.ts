"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { minimizeMobileApp, isMobileApp } from "@/lib/mobile-bridge";
import { resolveBack, routeKey } from "./route-parent";

/**
 * 本文档内的客户端路由记录（路径 + 查询参数）。window.history.length 会把通知深链（原生 loadUrl）之前的页面、
 * App 启动页也算进去，用它判断“能否后退”会退出当前文档，所以自己记录。
 */
const stack: string[] = [];
let replacing = false;

/** 根布局挂载一次（useSearchParams 需要放在 Suspense 里） */
export function useTrackNavStack() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = search ? `${pathname}?${search}` : pathname;
  useEffect(() => {
    const key = routeKey(href);
    const top = stack.length - 1;
    if (replacing && stack.length) {
      replacing = false;
      stack[top] = href;
    } else if (stack.length && routeKey(stack[top]) === key) {
      // 同一页只改了筛选 / 视图参数
      stack[top] = href;
    } else if (stack.length > 1 && routeKey(stack[top - 1]) === key) {
      stack.pop();
      stack[stack.length - 1] = href;
    } else {
      stack.push(href);
    }
  }, [href]);
}

type Router = ReturnType<typeof useRouter>;

/**
 * 所有“返回”的统一入口：退到上一级页面（层级见 route-parent.ts）。
 * 上一页正好是上一级时用历史后退（保留滚动位置与筛选），否则替换为上一级；一级页面在 App 内退到后台。
 */
export function navigateBack(router: Router, href = window.location.pathname + window.location.search) {
  const action = resolveBack(href, stack);
  if (action.kind === "exit") {
    if (isMobileApp()) minimizeMobileApp();
  } else if (action.kind === "history") {
    router.back();
  } else {
    replacing = true;
    router.replace(action.href);
  }
}
