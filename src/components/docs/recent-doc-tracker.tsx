"use client";

import { useEffect } from "react";
import { openRecentDoc } from "@/app/(app)/docs/recent-actions";
import { emitRecentDoc, type RecentDocDetail } from "@/components/shell/rail-events";

/** 打开文档后加入左侧导航栏「最近打开」，并在服务端记录（跨设备保留，手动关闭才移除） */
export function RecentDocTracker({ doc }: { doc: RecentDocDetail }) {
  const { id, title, icon, kind } = doc;
  useEffect(() => {
    emitRecentDoc({ id, title, icon, kind });
    void openRecentDoc(id);
    // 只在切换到另一篇文档时记录；标题变化由文档元信息事件同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}
