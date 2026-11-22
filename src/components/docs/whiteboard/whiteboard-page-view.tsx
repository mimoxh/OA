"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, GitFork, History, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { TopBar } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { saveVersion, toggleFavorite, trashDocument, updateDocument } from "@/app/(app)/docs/actions";
import type { BacklinksResult } from "@/lib/docs/links";
import { parseWhiteboard, WHITEBOARD_ICON } from "@/lib/docs/whiteboard/content";
import { BacklinksPanel } from "../backlinks-panel";
import { emitDocMeta } from "../events";
import { GraphDialog } from "../graph/graph-dialog";
import { HistoryDialog } from "../history-dialog";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { WhiteboardWorkspace, type WhiteboardWorkspaceHandle } from "./whiteboard-workspace";

export function WhiteboardPageView({
  board, ancestors, backlinks, favorite, canWrite,
}: {
  board: { id: string; title: string; icon: string | null; spaceId: string; spaceName: string; spaceIcon: string };
  ancestors: { id: string; title: string; icon: string | null }[];
  backlinks: BacklinksResult;
  favorite: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const { run } = useAction();
  const [title, setTitle] = useState(board.title);
  const [starred, setStarred] = useState(favorite);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const workspace = useRef<WhiteboardWorkspaceHandle>(null);
  const icon = board.icon ?? WHITEBOARD_ICON;

  const rename = async () => {
    const trimmed = title.trim();
    if (trimmed === board.title) return;
    const result = await run(() => updateDocument({ id: board.id, title: trimmed }), {
      onSuccess: () => {
        setTitle((value) => value.trim() === trimmed ? trimmed : value);
        emitDocMeta({ id: board.id, title: trimmed });
      },
    });
    if (!result.ok) setTitle((value) => value.trim() === trimmed ? board.title : value);
  };

  const saveCurrent = async () => {
    if (!await workspace.current?.flush()) return false;
    const result = await run(() => saveVersion({ documentId: board.id }), { success: "历史版本已保存", refresh: false });
    return result.ok;
  };

  return (
    <div className="min-h-full">
      <TopBar
        crumbs={[
          { label: `${board.spaceIcon} ${board.spaceName}`, href: `/docs?space=${board.spaceId}` },
          ...ancestors.map((a) => ({ label: `${a.icon || "📄"} ${a.title || "无标题"}`, href: `/docs/${a.id}` })),
          { label: `${icon} ${title || "未命名白板"}` },
        ]}
        actions={
          <>
            <IconButton title="查看局部关系图" aria-label="查看局部关系图" onClick={() => setGraphOpen(true)}>
              <GitFork className="size-4" />
            </IconButton>
            <IconButton
              title={starred ? "取消收藏" : "添加到收藏"}
              aria-label={starred ? "取消收藏" : "添加到收藏"}
              onClick={() => void run(() => toggleFavorite(board.id), { onSuccess: (data) => setStarred(data.favorite) })}
            >
              <Star className={starred ? "size-4 fill-amber-400 text-amber-400" : "size-4"} />
            </IconButton>
            <IconButton title="历史版本" aria-label="历史版本" onClick={() => setHistoryOpen(true)}>
              <History className="size-4" />
            </IconButton>
            <Menu>
              <MenuTrigger asChild>
                <IconButton title="更多操作" aria-label="更多操作"><MoreHorizontal className="size-4" /></IconButton>
              </MenuTrigger>
              <MenuContent align="end" className="w-44">
                <MenuItem
                  icon={<FileDown />}
                  onSelect={() => window.open(`/api/docs/${board.id}/export`, "_blank", "noopener,noreferrer")}
                >
                  导出白板 JSON
                </MenuItem>
                {canWrite && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={<Trash2 />}
                      danger
                      onSelect={() => void run(() => trashDocument(board.id), {
                        success: "白板已移到回收站",
                        onSuccess: () => router.push(`/docs?space=${board.spaceId}`),
                      })}
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
      <main className="mx-auto max-w-[1500px] px-3 pb-12 pt-4 sm:px-6">
        <h1 className="mb-2 flex items-center gap-3 text-2xl font-semibold text-ink">
          <span aria-hidden>{icon}</span>
          {canWrite ? (
            <input
              className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 outline-none hover:bg-hover focus:border-accent"
              aria-label="白板标题"
              placeholder="未命名白板"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={rename}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
              }}
            />
          ) : <span>{title || "未命名白板"}</span>}
        </h1>
        <WhiteboardWorkspace boardId={board.id} title={title} readOnly={!canWrite} refresh={refresh} saveRef={workspace} />
        <div className="mt-4">
          <BacklinksPanel
            docId={board.id}
            initialLinks={backlinks.links}
            initialTruncated={backlinks.truncated}
            onOpenGraph={() => setGraphOpen(true)}
          />
        </div>
      </main>
      <GraphDialog open={graphOpen} onOpenChange={setGraphOpen} docId={board.id} docTitle={title} spaceId={board.spaceId} />
      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        docId={board.id}
        canRestore={canWrite}
        onSaveCurrent={canWrite ? saveCurrent : undefined}
        onRestored={(restoredTitle) => {
          setTitle(restoredTitle);
          emitDocMeta({ id: board.id, title: restoredTitle });
          setRefresh((count) => count + 1);
        }}
        renderPreview={(version) => {
          const scene = parseWhiteboard(version.content);
          return scene ? <WhiteboardCanvas
            key={version.id} boardId={board.id} title={version.title} elements={scene.elements}
            references={version.references ?? []} compact
          /> : <p className="text-sm text-ink-3">该版本的白板内容无法读取</p>;
        }}
      />
    </div>
  );
}
