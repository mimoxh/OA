"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Copy, FilePlus2, FileUp, GitFork, Link2, Lock, MoreHorizontal, Palette, Pencil, Plus, Settings2, Star, StarOff, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/utils";
import type { NavSpace, TreeDoc } from "@/lib/docs/queries";
import { createDatabase, createDocument, createWhiteboard, duplicateDocument, moveDocument, toggleFavorite, trashDocument, updateDocument } from "@/app/(app)/docs/actions";
import { SpaceFormDialog } from "./space-dialog";
import { ImportDialog } from "./import-dialog";
import { DOC_META_EVENT, type DocMetaDetail } from "./events";

const EXPANDED_KEY = "docs:tree:expanded";
type DropPos = "before" | "after" | "inside";

export function DocsTree({
  spaces,
  docs,
  favoriteIds,
  canCreateSpace,
}: {
  spaces: NavSpace[];
  docs: TreeDoc[];
  favoriteIds: string[];
  canCreateSpace: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { run } = useAction();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [meta, setMeta] = useState<Record<string, DocMetaDetail>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos | "end" } | null>(null);
  const [spaceDialog, setSpaceDialog] = useState(false);
  const [importTarget, setImportTarget] = useState<{ spaceId: string; parentId: string | null } | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "{}"));
    } catch {}
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<DocMetaDetail>).detail;
      setMeta((m) => ({ ...m, [d.id]: { ...m[d.id], ...d } }));
    };
    window.addEventListener(DOC_META_EVENT, on);
    return () => window.removeEventListener(DOC_META_EVENT, on);
  }, []);

  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const childrenMap = useMemo(() => {
    const m = new Map<string, TreeDoc[]>();
    for (const d of docs) {
      const key = d.parentId ?? `space:${d.spaceId}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(d);
    }
    return m;
  }, [docs]);
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);

  const currentId = pathname.startsWith("/docs/") ? pathname.split("/")[2] : null;
  const currentAncestors = useMemo(() => {
    const s = new Set<string>();
    let cur = currentId ? byId.get(currentId)?.parentId : null;
    while (cur && !s.has(cur)) {
      s.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return s;
  }, [currentId, byId]);

  const isOpen = (key: string, fallback = false) => expanded[key] ?? fallback;
  const setOpen = (key: string, v: boolean) =>
    setExpanded((prev) => {
      const next = { ...prev, [key]: v };
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      return next;
    });

  const isAncestorOf = (ancestorId: string, nodeId: string) => {
    let cur: string | null = nodeId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === ancestorId) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  };

  const titleOf = (d: TreeDoc) => (meta[d.id]?.title ?? d.title) || "无标题";
  const iconOf = (d: TreeDoc) =>
    (meta[d.id] && "icon" in meta[d.id] ? meta[d.id].icon : d.icon) || (d.kind === "database" ? "🗃️" : "📄");

  const newPage = (spaceId: string, parentId?: string) =>
    run(() => createDocument({ spaceId, parentId }), {
      onSuccess: (d) => {
        if (parentId) setOpen(parentId, true);
        router.push(`/docs/${d.id}`);
      },
    });

  const newDatabase = (spaceId: string, parentId?: string) =>
    run(() => createDatabase({ spaceId, parentId }), {
      onSuccess: (d) => {
        if (parentId) setOpen(parentId, true);
        router.push(`/docs/${d.id}`);
      },
    });

  const newWhiteboard = (spaceId: string, parentId?: string) =>
    run(() => createWhiteboard({ spaceId, parentId }), {
      onSuccess: (board) => {
        if (parentId) setOpen(parentId, true);
        router.push(`/docs/${board.id}`);
      },
    });

  const onRowDragOver = (e: DragEvent<HTMLDivElement>, d: TreeDoc) => {
    if (!dragId || dragId === d.id || isAncestorOf(dragId, d.id) || !spaceById.get(d.spaceId)?.canEdit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const pos: DropPos =
      d.kind === "database" || d.kind === "whiteboard"
        ? y < r.height * 0.5
          ? "before"
          : "after"
        : y < r.height * 0.28
          ? "before"
          : y > r.height * 0.72
            ? "after"
            : "inside";
    if (drop?.id !== d.id || drop.pos !== pos) setDrop({ id: d.id, pos });
  };

  const finishDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const onRowDrop = (e: DragEvent<HTMLDivElement>, d: TreeDoc) => {
    e.preventDefault();
    const id = dragId;
    const pos = drop?.id === d.id ? drop.pos : null;
    finishDrag();
    if (!id || !pos || pos === "end") return;
    run(() => moveDocument({ id, targetId: d.id, spaceId: d.spaceId, position: pos }), {
      onSuccess: () => {
        if (pos === "inside") setOpen(d.id, true);
      },
    });
  };

  const renderDoc = (d: TreeDoc, depth: number, prefix: string, dnd: boolean): ReactNode => {
    const key = prefix + d.id;
    const isLeaf = d.kind === "database" || d.kind === "whiteboard";
    const kids = isLeaf ? [] : (childrenMap.get(d.id) ?? []);
    const open = !isLeaf && isOpen(key, !prefix && currentAncestors.has(d.id));
    const active = currentId === d.id;
    const space = spaceById.get(d.spaceId);
    const canEdit = !!space?.canEdit;
    const dropHere = dnd && drop?.id === d.id ? drop.pos : null;
    return (
      <div key={key}>
        <div
          draggable={dnd && canEdit && renaming !== d.id}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", d.id);
            setDragId(d.id);
          }}
          onDragEnd={finishDrag}
          onDragOver={dnd ? (e) => onRowDragOver(e, d) : undefined}
          onDragLeave={dnd ? () => drop?.id === d.id && setDrop(null) : undefined}
          onDrop={dnd ? (e) => onRowDrop(e, d) : undefined}
          data-doc-id={d.id}
          className={cn(
            "group/row relative flex h-[30px] items-center gap-1 rounded-md pr-1 text-sm text-ink-2 transition-colors hover:bg-active/70",
            active && "bg-active/80 font-medium text-ink",
            dropHere === "inside" && "bg-accent-soft ring-1 ring-accent/60",
            dragId === d.id && "opacity-40",
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {dropHere === "before" && <span className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded bg-accent" />}
          {dropHere === "after" && <span className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded bg-accent" />}
          {isLeaf ? (
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-3">
              {d.kind === "whiteboard" ? <Palette className="size-3" /> : <Table2 className="size-3" />}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(key, !open)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
              aria-label={open ? "收起" : "展开"}
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          )}
          {renaming === d.id ? (
            <RenameInput
              initial={titleOf(d) === "无标题" ? "" : titleOf(d)}
              onDone={(title) => {
                setRenaming(null);
                if (title === null || title === d.title) return;
                setMeta((m) => ({ ...m, [d.id]: { ...m[d.id], id: d.id, title } }));
                run(() => updateDocument({ id: d.id, title }), { success: "已重命名" });
              }}
            />
          ) : (
            <Link href={`/docs/${d.id}`} className="flex min-w-0 flex-1 items-center gap-1.5" draggable={false}>
              <span className="shrink-0 text-[15px] leading-none">{iconOf(d)}</span>
              <span className={cn("truncate", !(meta[d.id]?.title ?? d.title) && "text-ink-3")}>{titleOf(d)}</span>
            </Link>
          )}
          {renaming !== d.id && (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100">
              <RowMenu
                doc={d}
                canEdit={canEdit}
                favorite={favoriteIds.includes(d.id)}
                onRename={() => setRenaming(d.id)}
                onFavorite={() => run(() => toggleFavorite(d.id), { onSuccess: (r) => toast.success(r.favorite ? "已添加到收藏" : "已取消收藏") })}
                onDuplicate={() => run(() => duplicateDocument(d.id), { success: "已创建副本", onSuccess: (r) => router.push(`/docs/${r.id}`) })}
                onTrash={() =>
                  run(() => trashDocument(d.id), {
                    success: "已移到回收站",
                    onSuccess: () => {
                      if (currentId === d.id || (currentId && isAncestorOf(d.id, currentId))) router.push("/docs");
                    },
                  })
                }
                onImport={() => setImportTarget({ spaceId: d.spaceId, parentId: d.id })}
                onNewDatabase={() => newDatabase(d.spaceId, d.id)}
                onNewWhiteboard={() => newWhiteboard(d.spaceId, d.id)}
              />
              {canEdit && !isLeaf && (
                <button
                  type="button"
                  title="新建子页面"
                  onClick={() => newPage(d.spaceId, d.id)}
                  className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        {open && (
          <div>
            {kids.length ? (
              kids.map((c) => renderDoc(c, depth + 1, prefix, dnd))
            ) : (
              <div className="flex h-7 items-center text-xs text-ink-3" style={{ paddingLeft: 30 + (depth + 1) * 14 }}>
                没有页面
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const favorites = favoriteIds.map((id) => byId.get(id)).filter((d): d is TreeDoc => !!d);

  return (
    <div className="space-y-3">
      {favorites.length > 0 && (
        <Section label="收藏" open={isOpen("section:fav", true)} onToggle={(v) => setOpen("section:fav", v)}>
          {favorites.map((d) => renderDoc(d, 0, "fav:", false))}
        </Section>
      )}

      <Section
        label="文档"
        href="/docs"
        open={isOpen("section:spaces", true)}
        onToggle={(v) => setOpen("section:spaces", v)}
        action={
          <div className="flex items-center gap-0.5">
            <Link
              href="/docs/graph"
              title="文档关系图"
              className={cn(
                "flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink",
                pathname === "/docs/graph" && "bg-active text-ink",
              )}
            >
              <GitFork className="size-3.5" />
            </Link>
            {canCreateSpace && (
              <button
                type="button"
                title="新建空间"
                onClick={() => setSpaceDialog(true)}
                className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
              >
                <Plus className="size-3.5" />
              </button>
            )}
          </div>
        }
      >
        {spaces.map((s) => {
          const roots = childrenMap.get(`space:${s.id}`) ?? [];
          const open = isOpen(`space:${s.id}`, true);
          const dropEnd = drop?.id === `space:${s.id}`;
          return (
            <div key={s.id}>
              <div
                onDragOver={(e) => {
                  if (!dragId || !s.canEdit) return;
                  e.preventDefault();
                  if (!dropEnd) setDrop({ id: `space:${s.id}`, pos: "end" });
                }}
                onDragLeave={() => dropEnd && setDrop(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragId;
                  finishDrag();
                  if (id) run(() => moveDocument({ id, spaceId: s.id, position: "end" }), { success: `已移动到「${s.name}」` });
                }}
                className={cn(
                  "group/row flex h-[30px] items-center gap-1 rounded-md pl-1 pr-1 text-sm text-ink-2 hover:bg-active/70",
                  dropEnd && "bg-accent-soft ring-1 ring-accent/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(`space:${s.id}`, !open)}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                  aria-label={open ? "收起" : "展开"}
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                </button>
                <Link href={`/docs?space=${s.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
                  <span className="shrink-0 text-[15px] leading-none">{s.icon}</span>
                  <span className="truncate">{s.name}</span>
                  {s.visibility === "PRIVATE" && <Lock className="size-3 shrink-0 text-ink-3" />}
                </Link>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
                  <Link
                    href={`/docs?space=${s.id}`}
                    title="空间设置与成员"
                    className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                  >
                    <Settings2 className="size-3.5" />
                  </Link>
                  {s.canEdit && (
                    <button
                      type="button"
                      title="导入 Markdown…"
                      onClick={() => setImportTarget({ spaceId: s.id, parentId: null })}
                      className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <FileUp className="size-3.5" />
                    </button>
                  )}
                  {s.canEdit && (
                    <button
                      type="button"
                      title="在此空间新建多维表格"
                      onClick={() => newDatabase(s.id)}
                      className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <Table2 className="size-3.5" />
                    </button>
                  )}
                  {s.canEdit && (
                    <button
                      type="button"
                      title="在此空间新建白板"
                      onClick={() => newWhiteboard(s.id)}
                      className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <Palette className="size-3.5" />
                    </button>
                  )}
                  {s.canEdit && (
                    <button
                      type="button"
                      title="在此空间新建页面"
                      onClick={() => newPage(s.id)}
                      className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {open && (
                <div>
                  {roots.map((d) => renderDoc(d, 1, "", true))}
                  {roots.length === 0 &&
                    (s.canEdit ? (
                      <button
                        type="button"
                        onClick={() => newPage(s.id)}
                        className="flex h-7 w-full items-center gap-1.5 rounded-md pl-[34px] text-xs text-ink-3 hover:bg-active/70 hover:text-ink-2"
                      >
                        <FilePlus2 className="size-3.5" />
                        新建页面
                      </button>
                    ) : (
                      <div className="flex h-7 items-center pl-[34px] text-xs text-ink-3">没有页面</div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {spaces.length === 0 && <div className="px-2 py-1 text-xs text-ink-3">暂无可访问的空间</div>}
      </Section>
      <SpaceFormDialog open={spaceDialog} onOpenChange={setSpaceDialog} />
      {importTarget && (
        <ImportDialog spaceId={importTarget.spaceId} parentId={importTarget.parentId} open onOpenChange={(v) => !v && setImportTarget(null)} />
      )}
    </div>
  );
}

function Section({
  label,
  href,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  href?: string;
  open: boolean;
  onToggle: (v: boolean) => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="group/sec flex h-6 items-center justify-between rounded-md px-2 hover:bg-active/50">
        <button type="button" onClick={() => onToggle(!open)} className="flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-ink-2">
          {label}
          <ChevronRight className={cn("size-3 opacity-0 transition group-hover/sec:opacity-100", open && "rotate-90")} />
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/sec:opacity-100">
          {href && (
            <Link href={href} className="rounded px-1 text-[11px] text-ink-3 hover:bg-active hover:text-ink">
              全部
            </Link>
          )}
          {action}
        </div>
      </div>
      {open && <div className="space-y-px">{children}</div>}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (val: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(val);
  };
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(v.trim());
        if (e.key === "Escape") finish(null);
      }}
      placeholder="无标题"
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-white px-1.5 text-sm text-ink outline-none ring-2 ring-accent/15"
    />
  );
}

function RowMenu({
  doc,
  canEdit,
  favorite,
  onRename,
  onFavorite,
  onDuplicate,
  onTrash,
  onImport,
  onNewDatabase,
  onNewWhiteboard,
}: {
  doc: TreeDoc;
  canEdit: boolean;
  favorite: boolean;
  onRename: () => void;
  onFavorite: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onImport: () => void;
  onNewDatabase: () => void;
  onNewWhiteboard: () => void;
}) {
  const canCreateUnder = canEdit && doc.kind === "page";
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" title="更多" className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink">
          <MoreHorizontal className="size-3.5" />
        </button>
      </MenuTrigger>
      <MenuContent className="w-48">
        {canEdit && (
          <MenuItem icon={<Pencil />} onSelect={() => setTimeout(onRename, 0)}>
            重命名
          </MenuItem>
        )}
        <MenuItem icon={favorite ? <StarOff /> : <Star />} onSelect={onFavorite}>
          {favorite ? "取消收藏" : "添加到收藏"}
        </MenuItem>
        <MenuItem
          icon={<Link2 />}
          onSelect={() => {
            navigator.clipboard.writeText(`${location.origin}/docs/${doc.id}`).then(
              () => toast.success("链接已复制"),
              () => toast.error("复制失败"),
            );
          }}
        >
          复制链接
        </MenuItem>
        {canCreateUnder && (
          <MenuItem icon={<Table2 />} onSelect={onNewDatabase}>
            新建子多维表格
          </MenuItem>
        )}
        {canCreateUnder && (
          <MenuItem icon={<Palette />} onSelect={onNewWhiteboard}>
            新建子白板
          </MenuItem>
        )}
        {canCreateUnder && (
          <MenuItem icon={<Copy />} onSelect={onDuplicate}>
            创建副本
          </MenuItem>
        )}
        {canCreateUnder && (
          <MenuItem icon={<FileUp />} onSelect={onImport}>
            导入到此页面下
          </MenuItem>
        )}
        {canEdit && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={onTrash}>
              移到回收站
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
