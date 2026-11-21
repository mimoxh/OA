/** 文档页修改标题/图标时通知侧边栏页面树即时更新（无需刷新服务端数据） */
export const DOC_META_EVENT = "docs:meta";

export type DocMetaDetail = { id: string; title?: string; icon?: string | null };

export function emitDocMeta(detail: DocMetaDetail) {
  window.dispatchEvent(new CustomEvent<DocMetaDetail>(DOC_META_EVENT, { detail }));
}
