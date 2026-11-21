"use client";

import { useEffect } from "react";

/** 服务端在渲染时把通知标为已读后，通知侧边栏刷新未读数 */
export function NotificationsChanged({ changed }: { changed: boolean }) {
  useEffect(() => {
    if (changed) window.dispatchEvent(new Event("notifications:changed"));
  }, [changed]);
  return null;
}
