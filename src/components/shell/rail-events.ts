/** 打开文档时通知左侧导航栏把它加入「最近打开」（无需刷新服务端数据） */
export const RECENT_DOC_EVENT = "rail:recent-doc";

export type RecentDocDetail = { id: string; title: string; icon: string | null; kind: string };

export function emitRecentDoc(detail: RecentDocDetail) {
  window.dispatchEvent(new CustomEvent<RecentDocDetail>(RECENT_DOC_EVENT, { detail }));
}
