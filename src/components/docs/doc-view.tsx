"use client";

import "./editor/editor.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Editor } from "@tiptap/react";
import type { Range } from "@tiptap/core";
import {
  Copy,
  FileDown,
  FilePlus2,
  GitFork,
  History,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  MoveHorizontal,
  Palette,
  Save,
  Star,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { TopBar } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COVERS, coverStyle } from "@/lib/docs/constants";
import { isEmptyDoc, parseContent } from "@/lib/docs/content";
import type { BacklinkItem } from "@/lib/docs/links";
import { BUILTIN_TEMPLATES } from "@/lib/docs/templates";
import {
  createDatabase,
  duplicateDocument,
  notifyDocMention,
  saveAsTemplate,
  saveVersion,
  toggleFavorite,
  trashDocument,
  updateDocument,
  createDocument,
} from "@/app/(app)/docs/actions";
import { emitDocMeta } from "./events";
import { BacklinksPanel } from "./backlinks-panel";
import { EmojiPicker } from "./emoji-picker";
import { GraphDialog } from "./graph/graph-dialog";
import { HistoryDialog } from "./history-dialog";
import { PagePickerDialog } from "./page-picker";
import { UrlDialog } from "./url-dialog";
import { CommentsPanel, type PendingSelection } from "./comments-panel";
import { CollabEditor, type EditorCallbacks } from "./editor/collab-editor";
import { DatabaseLinkPickerDialog } from "./editor/database-view-node";
import { uploadFilesIntoEditor } from "./editor/upload";
import { StaticDoc } from "./editor/static-doc";
import { useCollab } from "./editor/use-collab";
import { RowPropertiesBar, type RowPropertiesContext } from "./database/row-properties-bar";
import type { CommentThread, Member } from "./types";
import { ShareToChatButton } from "@/components/im/share-to-chat";

export type DocViewProps = {
  doc: {
    id: string;
    kind?: string;
    title: string;
    icon: string | null;
    cover: string | null;
    fullWidth: boolean;
    /** 服务端最新持久化内容（离线回退渲染用） */
    content: string;
    spaceId: string;
    spaceName: string;
    spaceIcon: string;
    parentId: string | null;
    updatedAt: string;
    updatedBy: { name: string; avatarColor: string } | null;
  };
  rowProperties?: RowPropertiesContext | null;
  ancestors: { id: string; title: string; icon: string | null }[];
  childPages: { id: string; title: string; icon: string | null }[];
  backlinks: BacklinkItem[];
  backlinksTruncated: boolean;
  threads: CommentThread[];
  members: Member[];
  me: { id: string; name: string; color: string };
  canWrite: boolean;
  canAdmin: boolean;
  favorite: boolean;
  focusComment?: string | null;
};

type StatelessMsg = { type?: string; title?: string; icon?: string | null; cover?: string | null; fullWidth?: boolean; by?: string };

const STATUS_LABEL = { connecting: "连接中", connected: "已连接", disconnected: "已离线" } as const;

function CoverPicker({ onPick, onRemove }: { onPick: (key: string) => void; onRemove?: () => void }) {
  return (
    <div className="w-64">
      <div className="grid grid-cols-4 gap-1.5">
        {Object.entries(COVERS).map(([key, c]) => (
          <button
            key={key}
            type="button"
            title={c.label}
            onClick={() => onPick(key)}
            className="h-10 rounded-md border border-line transition-transform hover:scale-[1.03]"
            style={{ background: c.css }}
          />
        ))}
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} className="mt-2 flex h-7 w-full items-center justify-center rounded text-xs text-ink-2 hover:bg-hover">
          移除封面
        </button>
      )}
    </div>
  );
}

export function DocView({
  doc,
  rowProperties,
  ancestors,
  childPages,
  backlinks,
  backlinksTruncated,
  threads,
  members,
  me,
  canWrite,
  canAdmin,
  favorite: favorite0,
  focusComment,
}: DocViewProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [title, setTitle] = useState(doc.title);
  const [icon, setIcon] = useState(doc.icon);
  const [cover, setCover] = useState(doc.cover);
  const [fullWidth, setFullWidth] = useState(doc.fullWidth);
  const [favorite, setFavorite] = useState(favorite0);
  const [commentsOpen, setCommentsOpen] = useState(!!focusComment);
  const [focusThread, setFocusThread] = useState<string | null>(focusComment ?? null);
  const [pendingSel, setPendingSel] = useState<PendingSelection | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [dbPickerOpen, setDbPickerOpen] = useState(false);
  const [whiteboardPickerOpen, setWhiteboardPickerOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [hasContent, setHasContent] = useState(() => !isEmptyDoc(parseContent(doc.content)));
  const pendingRange = useRef<Range | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const attachFileRef = useRef<HTMLInputElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTitle = useRef<string | null>(null);

  const onStateless = useCallback(
    (msg: StatelessMsg) => {
      switch (msg.type) {
        case "title": {
          const t = String(msg.title ?? "");
          setTitle(t);
          emitDocMeta({ id: doc.id, title: t });
          break;
        }
        case "meta": {
          if (msg.title !== undefined) {
            const t = String(msg.title ?? "");
            setTitle(t);
            emitDocMeta({ id: doc.id, title: t, icon: msg.icon });
          }
          if (msg.icon !== undefined) {
            setIcon(msg.icon ?? null);
            emitDocMeta({ id: doc.id, icon: msg.icon ?? null });
          }
          if (msg.cover !== undefined) setCover(msg.cover ?? null);
          if (msg.fullWidth !== undefined) setFullWidth(!!msg.fullWidth);
          break;
        }
        case "comments":
          router.refresh();
          break;
        case "restored":
          toast.success(`${msg.by ?? "有人"} 恢复了历史版本`);
          if (msg.title !== undefined) {
            setTitle(String(msg.title ?? ""));
            emitDocMeta({ id: doc.id, title: String(msg.title ?? "") });
          }
          router.refresh();
          break;
        case "trashed":
          toast("该页面已被移入回收站");
          router.push("/docs");
          break;
      }
    },
    [doc.id, router],
  );

  const collab = useCollab(doc.id, onStateless);
  const { session, status, everSynced, readOnly, error, peers, unsynced, send } = collab;

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setHasContent(!editor.isEmpty);
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  const broadcast = useCallback(
    (msg: StatelessMsg) => {
      try {
        send(msg as Record<string, unknown>);
      } catch {
        // 离线时丢弃实时通知，数据已通过服务端动作持久化
      }
    },
    [send],
  );

  // ── 标题：输入即广播 + 防抖持久化；失焦/卸载时把未保存的标题写回 ──
  const flushTitle = () => {
    if (pendingTitle.current === null) return;
    const v = pendingTitle.current;
    pendingTitle.current = null;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    void updateDocument({ id: doc.id, title: v, silent: true }).then((r) => {
      if (!r.ok) toast.error(r.error);
    });
  };
  useEffect(
    () => () => {
      if (pendingTitle.current !== null) {
        void updateDocument({ id: doc.id, title: pendingTitle.current, silent: true }).catch(() => {});
      }
    },
    [doc.id],
  );

  const onTitleChange = (v: string) => {
    if (v.length > 200) return;
    setTitle(v);
    pendingTitle.current = v;
    emitDocMeta({ id: doc.id, title: v });
    broadcast({ type: "title", title: v });
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(flushTitle, 700);
  };

  const onPickIcon = (emoji: string) => {
    setIcon(emoji);
    emitDocMeta({ id: doc.id, icon: emoji });
    void run(() => updateDocument({ id: doc.id, icon: emoji }), { refresh: false });
  };
  const onRemoveIcon = () => {
    setIcon(null);
    emitDocMeta({ id: doc.id, icon: null });
    void run(() => updateDocument({ id: doc.id, icon: null }), { refresh: false });
  };
  const onPickCover = (key: string) => {
    setCover(key);
    void run(() => updateDocument({ id: doc.id, cover: key }), { refresh: false });
  };
  const onRemoveCover = () => {
    setCover(null);
    void run(() => updateDocument({ id: doc.id, cover: null }), { refresh: false });
  };

  // ── 编辑器回调 ──
  const callbacks = useMemo<EditorCallbacks>(
    () => ({
      onCommentClick: (id) => {
        setCommentsOpen(true);
        setFocusThread(id);
      },
      onAddComment: (sel) => {
        setPendingSel(sel);
        setCommentsOpen(true);
        setFocusThread(null);
      },
      onLinkPage: (range) => {
        pendingRange.current = range;
        setPagePickerOpen(true);
      },
      onCreateDatabase: (range) => {
        if (!canWrite) return;
        const pos = range.from;
        void createDatabase({
          spaceId: doc.spaceId,
          parentId: doc.kind === "row" ? null : doc.id,
        }).then((res) => {
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          const ed = editorRef.current;
          if (ed) {
            ed.chain()
              .focus()
              .insertContentAt(Math.min(pos, ed.state.doc.content.size), {
                type: "databaseView",
                attrs: { databaseId: res.data.id, viewId: res.data.defaultViewId },
              })
              .run();
          }
          toast.success("已新建并嵌入多维表格");
          router.refresh();
        });
      },
      onLinkDatabase: (range) => {
        pendingRange.current = range;
        setDbPickerOpen(true);
      },
      onEmbedWhiteboard: (range) => {
        pendingRange.current = range;
        setWhiteboardPickerOpen(true);
      },
      onImage: (range) => {
        pendingRange.current = range;
        setImageDialogOpen(true);
      },
      onFile: (range) => {
        pendingRange.current = range;
        attachFileRef.current?.click();
      },
      onFiles: (files, pos) => {
        if (!canWrite) return;
        void uploadFilesIntoEditor(editorRef.current, files, doc.id, pos);
      },
      onMention: (userId) => {
        void run(() => notifyDocMention({ documentId: doc.id, userIds: [userId] }), { refresh: false });
      },
      onQuickCreatePage: async (pageTitle) => {
        const res = await createDocument({ spaceId: doc.spaceId, title: pageTitle });
        if (!res.ok) {
          toast.error(res.error);
          return null;
        }
        toast.success(`已新建页面「${res.data.title || pageTitle}」`);
        router.refresh();
        return { id: res.data.id, title: res.data.title || pageTitle };
      },
    }),
    [doc.id, doc.kind, doc.spaceId, canWrite, run, router],
  );

  const onEditorReady = useCallback((e: Editor | null) => {
    editorRef.current = e;
    setEditor(e);
  }, []);

  const uploadPickedFiles = (input: HTMLInputElement | null) => {
    const files = [...(input?.files ?? [])];
    if (input) input.value = "";
    setImageDialogOpen(false);
    if (!files.length || !canWrite) return;
    const pos = pendingRange.current?.from ?? null;
    pendingRange.current = null;
    void uploadFilesIntoEditor(editorRef.current, files, doc.id, pos);
  };

  const insertAt = (content: Record<string, unknown>) => {
    if (!editor) return;
    const pos = pendingRange.current?.from;
    pendingRange.current = null;
    editor
      .chain()
      .focus()
      .insertContentAt(pos ?? editor.state.selection.from, content)
      .run();
  };

  const applyCommentMark = (commentId: string | null) => {
    const sel = pendingSel;
    setPendingSel(null);
    if (!commentId || !sel || !editor) return;
    const size = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: Math.min(sel.from, size), to: Math.min(sel.to, size) })
      .setMark("comment", { commentId })
      .setTextSelection(Math.min(sel.to, size))
      .run();
  };

  const saveCurrentVersion = async () => {
    const content = editor ? JSON.stringify(editor.getJSON()) : doc.content;
    const r = await saveVersion({ documentId: doc.id, title: title || "无标题", content });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("已保存当前版本");
    return true;
  };

  const applyTemplate = (key: string) => {
    const t = BUILTIN_TEMPLATES.find((x) => x.key === key);
    if (!t || !editor) return;
    editor.chain().focus().setContent(t.content()).run();
    const nt = t.title();
    setTitle(nt);
    setIcon(t.icon);
    emitDocMeta({ id: doc.id, title: nt, icon: t.icon });
    void run(() => updateDocument({ id: doc.id, title: nt, icon: t.icon }), { refresh: false });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${location.origin}/docs/${doc.id}`).then(
      () => toast.success("链接已复制"),
      () => toast.error("复制失败"),
    );
  };

  const mentionItems = useMemo(() => members.map((m) => ({ id: m.id, label: m.name, color: m.avatarColor, title: m.title })), [members]);
  const openCount = threads.filter((t) => !t.resolved).length;
  const staticContent = useMemo(() => parseContent(doc.content), [doc.content]);
  const coverCss = coverStyle(cover);
  const editable = canWrite && !readOnly;
  const showEditor = !!session && everSynced;
  const offline = status === "disconnected" || !!error;

  const crumbs = [
    { label: "文档", href: "/docs" },
    { label: `${doc.spaceIcon} ${doc.spaceName}`, href: `/docs?space=${doc.spaceId}` },
    ...ancestors.map((a) => ({ label: `${a.icon || "📄"} ${a.title || "无标题"}`, href: `/docs/${a.id}` })),
    { label: title || "无标题" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        crumbs={crumbs}
        actions={
          <>
            <span
              title={error ?? (unsynced > 0 ? `${unsynced} 处更改待同步` : undefined)}
              className="flex h-7 items-center gap-1.5 rounded px-1.5 text-xs text-ink-3"
            >
              {status === "disconnected" ? <WifiOff className="size-3.5 text-danger/70" /> : <Wifi className={cn("size-3.5", status === "connected" ? "text-tag-green-ink/80" : "text-ink-3")} />}
              {STATUS_LABEL[status]}
            </span>
            {peers.length > 0 && <AvatarStack users={peers.map((p) => ({ name: p.name, avatarColor: p.color }))} max={5} />}
            <IconButton
              title={favorite ? "取消收藏" : "收藏"}
              onClick={() =>
                void run(() => toggleFavorite(doc.id), {
                  refresh: false,
                  onSuccess: (r) => {
                    setFavorite(r.favorite);
                    router.refresh();
                  },
                })
              }
            >
              <Star className={cn("size-4", favorite && "fill-tag-yellow-ink/80 text-tag-yellow-ink/80")} />
            </IconButton>
            <IconButton title="复制链接" onClick={copyLink}>
              <Link2 className="size-4" />
            </IconButton>
            <ShareToChatButton
              refType="document"
              refId={doc.id}
              title={title || "无标题"}
              subtitle={doc.spaceName}
              variant="icon"
            />
            <IconButton
              title="评论"
              className={cn(commentsOpen && "bg-active text-ink")}
              onClick={() => {
                setCommentsOpen((v) => !v);
                setFocusThread(null);
              }}
            >
              <span className="relative">
                <MessageSquare className="size-4" />
                {openCount > 0 && <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-semibold text-white">{openCount}</span>}
              </span>
            </IconButton>
            <IconButton title="关系图" onClick={() => setGraphOpen(true)}>
              <GitFork className="size-4" />
            </IconButton>
            <IconButton title="历史版本" onClick={() => setHistoryOpen(true)}>
              <History className="size-4" />
            </IconButton>
            <Menu>
              <MenuTrigger asChild>
                <IconButton title="更多">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end" className="w-52">
                {canWrite && (
                  <MenuItem icon={<MoveHorizontal />} onSelect={() => void run(() => updateDocument({ id: doc.id, fullWidth: !fullWidth }), { refresh: false, onSuccess: () => setFullWidth(!fullWidth) })}>
                    {fullWidth ? "取消全宽" : "全宽显示"}
                  </MenuItem>
                )}
                <MenuItem icon={<FileDown />} onSelect={() => window.open(`/api/docs/${doc.id}/export`, "_blank")}>
                  导出 Markdown
                </MenuItem>
                {doc.kind !== "row" && (
                  <MenuItem icon={<FileDown />} onSelect={() => window.open(`/api/docs/${doc.id}/export?subtree=1`, "_blank")}>
                    导出（含子页面）
                  </MenuItem>
                )}
                {canWrite && (
                  <MenuItem
                    icon={<Save />}
                    onSelect={() => {
                      void saveCurrentVersion();
                    }}
                  >
                    保存当前版本
                  </MenuItem>
                )}
                {canWrite && (
                  <>
                    {doc.kind !== "row" && (
                      <>
                        <MenuSeparator />
                        <MenuItem
                          icon={<Copy />}
                          onSelect={() => void run(() => duplicateDocument(doc.id), { success: "已创建副本", onSuccess: (r) => router.push(`/docs/${r.id}`) })}
                        >
                          创建副本
                        </MenuItem>
                        <MenuItem icon={<FilePlus2 />} onSelect={() => void run(() => saveAsTemplate(doc.id), { success: "已保存为模板" })}>
                          保存为模板
                        </MenuItem>
                      </>
                    )}
                    <MenuSeparator />
                    <MenuItem
                      icon={<Trash2 />}
                      danger
                      onSelect={() =>
                        void run(() => trashDocument(doc.id), {
                          success: "已移到回收站",
                          onSuccess: () => router.push(doc.kind === "row" && doc.parentId ? `/docs/${doc.parentId}` : "/docs"),
                        })
                      }
                    >
                      移到回收站
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 items-start">
        <div className="min-w-0 flex-1 pb-24">
          {coverCss && (
            <div className="group/cover relative h-44" style={{ background: coverCss }}>
              {canWrite && (
                <div className="absolute bottom-3 right-6 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs text-ink-2 shadow-card hover:bg-white">
                        更换封面
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end">
                      <CoverPicker onPick={onPickCover} onRemove={onRemoveCover} />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          )}

          <div className={cn("mx-auto w-full px-6 sm:px-10", fullWidth ? "max-w-[1400px] lg:px-16" : "max-w-[800px]")}>
            <div className={cn("group/head relative z-10", coverCss ? "-mt-10" : "pt-12")}>
              <EmojiPicker onSelect={onPickIcon} onRemove={canWrite && icon ? onRemoveIcon : undefined}>
                <button
                  type="button"
                  disabled={!canWrite}
                  className={cn("rounded-lg text-[64px] leading-none transition-colors", canWrite && "hover:bg-hover", !icon && "p-2 text-4xl text-ink-3")}
                  title={canWrite ? "更换图标" : undefined}
                >
                  {icon || (canWrite ? "☺" : "📄")}
                </button>
              </EmojiPicker>
              {canWrite && (
                <div className="mt-1 flex h-7 items-center gap-1 opacity-0 transition-opacity group-hover/head:opacity-100 has-[[data-state=open]]:opacity-100">
                {!icon && (
                  <EmojiPicker onSelect={onPickIcon}>
                    <button type="button" className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-ink-3 hover:bg-hover">
                      <Palette className="size-3.5" />
                      添加图标
                    </button>
                  </EmojiPicker>
                )}
                {!cover && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-ink-3 hover:bg-hover">
                        <ImageIcon className="size-3.5" />
                        添加封面
                      </button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <CoverPicker onPick={onPickCover} />
                    </PopoverContent>
                  </Popover>
                )}
                </div>
              )}
            </div>

            <textarea
              value={title}
              rows={1}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  editor?.chain().focus("start").run();
                }
              }}
              onBlur={flushTitle}
              placeholder="无标题"
              readOnly={!canWrite}
              className="doc-title mt-2 w-full resize-none overflow-hidden bg-transparent text-[38px] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-ink-3/60"
            />
            <div className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-3">
              {doc.updatedBy && (
                <>
                  <Avatar name={doc.updatedBy.name} color={doc.updatedBy.avatarColor} size={16} />
                  <span>{doc.updatedBy.name}</span>
                </>
              )}
              <span>最后编辑于 {formatRelative(doc.updatedAt)}</span>
              {!canWrite && <span className="rounded bg-hover px-1.5 py-0.5 text-[11px]">只读</span>}
            </div>

            {rowProperties && <RowPropertiesBar initial={rowProperties} />}

            <div className="mt-4">
              {showEditor ? (
                <CollabEditor
                  docId={doc.id}
                  provider={session.provider}
                  ydoc={session.ydoc}
                  user={session.user}
                  editable={editable}
                  members={mentionItems}
                  callbacks={callbacks}
                  onReady={onEditorReady}
                />
              ) : offline ? (
                <div>
                  <div className="mb-4 flex items-center gap-2 rounded-md border border-line bg-sidebar px-3 py-2 text-[13px] text-ink-2">
                    <WifiOff className="size-4 text-danger/70" />
                    {error ?? "协同服务已离线，当前为只读快照，恢复连接后自动同步"}
                  </div>
                  <StaticDoc
                    content={staticContent}
                    onCommentClick={(id) => {
                      setCommentsOpen(true);
                      setFocusThread(id);
                    }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 py-16 text-sm text-ink-3">
                  <Loader2 className="size-4 animate-spin" />
                  正在连接协同服务…
                </div>
              )}
            </div>

            {canWrite && editor && !hasContent && doc.kind !== "row" && (
              <div className="mt-6">
                <div className="mb-2 text-[13px] font-medium text-ink-3">从模板开始</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BUILTIN_TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => applyTemplate(t.key)}
                      className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-left transition-colors hover:bg-sidebar"
                    >
                      <span className="text-xl leading-none">{t.icon}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                        <span className="line-clamp-2 text-[11px] leading-snug text-ink-3">{t.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {doc.kind !== "row" && (childPages.length > 0 || canWrite) && (
              <div className="mt-10">
                <div className="mb-1 text-[13px] font-semibold text-ink-3">子页面</div>
                <div className="divide-y divide-line rounded-lg border border-line">
                  {childPages.map((c) => (
                    <Link key={c.id} href={`/docs/${c.id}`} className="flex h-10 items-center gap-2 px-3 hover:bg-hover/60">
                      <span className="text-base leading-none">{c.icon || "📄"}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.title || "无标题"}</span>
                    </Link>
                  ))}
                  {canWrite && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void run(() => createDocument({ spaceId: doc.spaceId, parentId: doc.id }), {
                          onSuccess: (d) => router.push(`/docs/${d.id}`),
                        })
                      }
                      className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[13px] text-ink-3 hover:bg-hover/60 hover:text-ink-2"
                    >
                      <FilePlus2 className="size-3.5" />
                      新建子页面
                    </button>
                  )}
                </div>
              </div>
            )}

            <BacklinksPanel
              docId={doc.id}
              initialLinks={backlinks}
              initialTruncated={backlinksTruncated}
              onOpenGraph={() => setGraphOpen(true)}
            />
          </div>
        </div>

        {commentsOpen && (
          <CommentsPanel
            docId={doc.id}
            threads={threads}
            members={members}
            meId={me.id}
            canEdit={canWrite}
            canAdmin={canAdmin}
            pendingSel={pendingSel}
            focusThread={focusThread}
            onSelectionDone={applyCommentMark}
            onChanged={() => broadcast({ type: "comments" })}
            onClose={() => setCommentsOpen(false)}
          />
        )}
      </div>

      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} docId={doc.id} canRestore={canWrite} onSaveCurrent={saveCurrentVersion} />
      <GraphDialog open={graphOpen} onOpenChange={setGraphOpen} docId={doc.id} docTitle={title} spaceId={doc.spaceId} />
      <PagePickerDialog
        open={pagePickerOpen}
        onOpenChange={setPagePickerOpen}
        excludeId={doc.id}
        onPick={(hit) => {
          setPagePickerOpen(false);
          insertAt({ type: "text", text: hit.title, marks: [{ type: "link", attrs: { href: `/docs/${hit.id}` } }] });
        }}
      />
      <DatabaseLinkPickerDialog
        open={dbPickerOpen}
        onOpenChange={setDbPickerOpen}
        onSelect={(databaseId, viewId) => {
          setDbPickerOpen(false);
          insertAt({ type: "databaseView", attrs: { databaseId, viewId } });
        }}
      />
      <PagePickerDialog
        open={whiteboardPickerOpen}
        onOpenChange={setWhiteboardPickerOpen}
        kind="whiteboard"
        onPick={(board) => {
          setWhiteboardPickerOpen(false);
          insertAt({ type: "whiteboardView", attrs: { boardId: board.id } });
        }}
      />
      <UrlDialog
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        title="插入图片"
        description="粘贴图片链接（http:// 或 https://），或上传本地图片"
        placeholder="https://example.com/image.png"
        onSubmit={(url) => {
          setImageDialogOpen(false);
          insertAt({ type: "image", attrs: { src: url } });
        }}
        extra={
          <Button className="mb-2 w-full" onClick={() => imageFileRef.current?.click()}>
            上传图片
          </Button>
        }
      />
      <input ref={attachFileRef} type="file" multiple hidden onChange={() => uploadPickedFiles(attachFileRef.current)} />
      <input ref={imageFileRef} type="file" accept="image/*" hidden onChange={() => uploadPickedFiles(imageFileRef.current)} />
    </div>
  );
}
