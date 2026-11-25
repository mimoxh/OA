"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * 本文档内的客户端路由记录。window.history.length 会把通知深链（原生 loadUrl）之前的页面、
 * App 启动页也算进去，用它判断“能否后退”会退出当前文档，所以自己记录。
 */
const stack: string[] = [];
let replacing = false;

/** 根布局挂载一次 */
export function useTrackNavStack() {
  const pathname = usePathname();
  useEffect(() => {
    if (stack.at(-1) === pathname) return;
    if (replacing && stack.length) {
      replacing = false;
      stack[stack.length - 1] = pathname;
    } else if (stack.at(-2) === pathname) {
      stack.pop();
    } else {
      stack.push(pathname);
    }
  }, [pathname]);
}

/** 二级页面没有本文档内的上一页时回到的一级页面 */
export function backFallback(pathname: string) {
  if (pathname.startsWith("/messages/")) return "/messages";
  if (pathname.startsWith("/me/")) return "/me";
  return "/work";
}

type Router = ReturnType<typeof useRouter>;

/** 页面内的“返回”：有站内上一页就后退，否则（如从通知直接打开）替换为所属一级页面 */
export function navigateBack(router: Router, pathname = window.location.pathname) {
  if (stack.length > 1) {
    router.back();
  } else {
    replacing = true;
    router.replace(backFallback(pathname));
  }
}
