"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, GitFork, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { TopBar } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { toggleFavorite, trashDocument, updateDocument } from "@/app/(app)/docs/actions";
import type { BacklinkItem } from "@/lib/docs/links";
import type { DatabasePayload } from "@/lib/docs/database/types";
import { BacklinksPanel } from "../backlinks-panel";
import { emitDocMeta } from "../events";
import { GraphDialog } from "../graph/graph-dialog";
import { DatabaseWorkspace } from "./database-workspace";

export function DatabasePageView({
  initialData,
  ancestors,
  favorite: initialFav,
  backlinks,
  backlinksTruncated,
}: {
  initialData: DatabasePayload;
  ancestors: { id: string; title: string; icon: string | null }[];
  favorite: boolean;
  backlinks: BacklinkItem[];
  backlinksTruncated: boolean;
}) {
  const router = useRouter();
  const { run } = useAction();
  const [title, setTitle] = useState(initialData.title);
  const [icon, setIcon] = useState(initialData.icon || "🗃️");
  const [favorite, setFavorite] = useState(initialFav);
  const [graphOpen, setGraphOpen] = useState(false);

  const commitTitle = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === initialData.title) return;
    emitDocMeta({ id: initialData.id, title: trimmed });
    run(() => updateDocument({ id: initialData.id, title: trimmed }));
  };

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        crumbs={[
          { label: `${initialData.spaceIcon} ${initialData.spaceName}`, href: `/docs?space=${initialData.spaceId}` },
          ...ancestors.map((a) => ({ label: `${a.icon || "📄"} ${a.title || "无标题"}`, href: `/docs/${a.id}` })),
          { label: `${icon} ${title || "未命名多维表格"}` },
        ]}
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setGraphOpen(true)}
              className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
              title="查看局部关系图"
            >
              <GitFork className="size-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                run(() => toggleFavorite(initialData.id), {
                  onSuccess: (r) => {
                    setFavorite(r.favorite);
                    toast.success(r.favorite ? "已添加到收藏" : "已取消收藏");
                  },
                })
              }
              className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
              title={favorite ? "取消收藏" : "添加到收藏"}
            >
              <Star className={`size-4 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
                  title="更多操作"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent className="w-44">
                <MenuItem
                  icon={<Download />}
                  onSelect={() => {
                    window.open(`/api/docs/${initialData.id}/export?format=csv`, "_blank");
                  }}
                >
                  导出为 CSV
                </MenuItem>
                <MenuItem
                  icon={<Download />}
                  onSelect={() => {
                    window.open(`/api/docs/${initialData.id}/export`, "_blank");
                  }}
                >
                  导出为 Markdown 表
                </MenuItem>
                {initialData.canWrite && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={<Trash2 />}
                      danger
                      onSelect={() =>
                        run(() => trashDocument(initialData.id), {
                          success: "多维表格已移入回收站",
                          onSuccess: () => router.push(`/docs?space=${initialData.spaceId}`),
                        })
                      }
                    >
                      移到回收站
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            disabled={!initialData.canWrite}
            onClick={() => {
              const next = window.prompt("输入多维表格图标（Emoji）", icon)?.trim();
              if (!next) return;
              setIcon(next);
              emitDocMeta({ id: initialData.id, icon: next });
              run(() => updateDocument({ id: initialData.id, icon: next }));
            }}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover/60 text-2xl hover:bg-hover"
            title="点击修改图标"
          >
            {icon}
          </button>
          <input
            value={title}
            disabled={!initialData.canWrite}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => commitTitle(title)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="未命名多维表格"
            className="min-w-0 flex-1 bg-transparent text-2xl font-bold text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        <DatabaseWorkspace databaseId={initialData.id} initialData={initialData} />

        <div className="mt-8">
          <BacklinksPanel
            docId={initialData.id}
            initialLinks={backlinks}
            initialTruncated={backlinksTruncated}
            onOpenGraph={() => setGraphOpen(true)}
          />
        </div>
      </div>

      <GraphDialog
        open={graphOpen}
        onOpenChange={setGraphOpen}
        docId={initialData.id}
        docTitle={title || "未命名多维表格"}
        spaceId={initialData.spaceId}
      />
    </div>
  );
}
