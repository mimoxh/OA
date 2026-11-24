"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, Settings2, Trash2, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { SPACE_ROLES } from "@/lib/docs/constants";
import { BUILTIN_TEMPLATES } from "@/lib/docs/templates";
import { cn } from "@/lib/utils";
import { createDocument, deleteSpace, deleteTemplate, removeSpaceMember, upsertSpaceMember } from "@/app/(app)/docs/actions";
import { SpaceFormDialog, type SpaceFormValue } from "./space-dialog";
import type { Member } from "./types";

export function SpaceActions({ space, pageCount }: { space: SpaceFormValue & { id: string }; pageCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Settings2 className="size-3.5" />
        空间设置
      </Button>
      {!space.personal && <SpaceDeleteButton space={space} pageCount={pageCount} variant="ghost" />}
      <SpaceFormDialog open={open} onOpenChange={setOpen} space={space} />
    </>
  );
}

export function SpaceDeleteButton({
  space,
  pageCount,
  variant,
}: {
  space: { id: string; name: string };
  pageCount: number;
  variant?: "ghost";
}) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ConfirmButton
      variant={variant}
      danger
      title={`删除空间「${space.name}」？`}
      description={`空间内的 ${pageCount} 个页面（含回收站中的页面）将被永久删除，且无法恢复。`}
      confirmText="永久删除"
      onConfirm={() => run(() => deleteSpace(space.id), { success: "空间已删除", onSuccess: () => router.push("/docs") })}
    >
      <Trash2 className="size-3.5" />
      删除空间
    </ConfirmButton>
  );
}

export function SpaceExportButton({ spaceId }: { spaceId: string }) {
  return (
    <Button variant="ghost" onClick={() => window.open(`/api/docs/spaces/${spaceId}/export`, "_blank")}>
      <FileDown className="size-3.5" />
      导出空间
    </Button>
  );
}

type MemberRow = Member & { role: string };

export function SpaceMembers({
  spaceId,
  canManage,
  isPrivate,
  members,
  users,
}: {
  spaceId: string;
  canManage: boolean;
  isPrivate: boolean;
  members: MemberRow[];
  users: Member[];
}) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState({ userId: "", role: "editor" });
  const candidates = users.filter((u) => !members.some((m) => m.id === u.id));

  return (
    <div>
      {!isPrivate && (
        <p className="mb-2 px-1 text-xs text-ink-3">公开空间对所有拥有文档权限的成员开放；成员角色用于指定所有者与只读成员。</p>
      )}
      <div className="space-y-0.5">
        {members.length === 0 && <div className="px-1 py-2 text-[13px] text-ink-3">暂无成员</div>}
        {members.map((m) => (
          <div key={m.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover/60">
            <Avatar name={m.name} color={m.avatarColor} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{m.name}</span>
              {m.title && <span className="block truncate text-[11px] text-ink-3">{m.title}</span>}
            </span>
            {canManage ? (
              <>
                <Select
                  aria-label={`${m.name} 的角色`}
                  className="h-7 w-[92px] text-xs"
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => run(() => upsertSpaceMember({ spaceId, userId: m.id, role: e.target.value as "owner" }), { success: "角色已更新" })}
                >
                  {Object.entries(SPACE_ROLES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
                <IconButton
                  title="移除成员"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => run(() => removeSpaceMember({ spaceId, userId: m.id }), { success: "已移除成员" })}
                >
                  <X className="size-3.5" />
                </IconButton>
              </>
            ) : (
              <span className="text-xs text-ink-3">{SPACE_ROLES[m.role]?.label ?? m.role}</span>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3">
          <Select
            aria-label="选择成员"
            className="h-7 min-w-0 flex-1 text-xs"
            value={adding.userId}
            onChange={(e) => setAdding({ ...adding, userId: e.target.value })}
          >
            <option value="">选择要添加的成员…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.title ? ` · ${u.title}` : ""}
              </option>
            ))}
          </Select>
          <Select
            aria-label="角色"
            className="h-7 w-[84px] text-xs"
            value={adding.role}
            onChange={(e) => setAdding({ ...adding, role: e.target.value })}
          >
            {Object.entries(SPACE_ROLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={!adding.userId || pending}
            onClick={() =>
              run(() => upsertSpaceMember({ spaceId, userId: adding.userId, role: adding.role as "editor" }), {
                success: "已添加成员",
                onSuccess: () => setAdding({ userId: "", role: "editor" }),
              })
            }
          >
            <UserPlus className="size-3.5" />
            添加
          </Button>
        </div>
      )}
    </div>
  );
}

type CustomTemplate = { id: string; title: string; icon: string | null; description: string; canDelete: boolean };

type GalleryItem = {
  key: string;
  icon: string;
  title: string;
  description: string;
  builtin: boolean;
  canDelete?: boolean;
  id?: string;
  onUse: () => void;
};

export function TemplateGallery({ spaceId, canEdit, custom }: { spaceId: string; canEdit: boolean; custom: CustomTemplate[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const applyTemplate = (input: { template?: string; templateDocId?: string }) =>
    run(() => createDocument({ spaceId, ...input }), { onSuccess: (d) => router.push(`/docs/${d.id}`) });
  const items: GalleryItem[] = [
    ...BUILTIN_TEMPLATES.map((t): GalleryItem => ({
      key: `b:${t.key}`,
      icon: t.icon,
      title: t.name,
      description: t.description,
      builtin: true,
      onUse: () => {
        void applyTemplate({ template: t.key });
      },
    })),
    ...custom.map(
      (t): GalleryItem => ({
        key: t.id,
        icon: t.icon || "📄",
        title: t.title,
        description: t.description || "自定义模板",
        builtin: false,
        canDelete: t.canDelete,
        id: t.id,
        onUse: () => {
          void applyTemplate({ templateDocId: t.id });
        },
      }),
    ),
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((t) => (
        <div
          key={t.key}
          className={cn("group relative flex items-start gap-3 rounded-lg border border-line p-3", canEdit && "cursor-pointer hover:bg-sidebar")}
          onClick={() => canEdit && !pending && t.onUse()}
        >
          <span className="text-2xl leading-none">{t.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <span className="truncate">{t.title}</span>
              {!t.builtin && <span className="rounded bg-tag-purple px-1 text-[10px] text-tag-purple-ink">自定义</span>}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-ink-2">{t.description}</span>
          </span>
          {t.canDelete && t.id && (
            <IconButton
              title="删除模板"
              className="absolute right-2 top-2 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                run(() => deleteTemplate(t.id!), { success: "模板已删除" });
              }}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          )}
        </div>
      ))}
    </div>
  );
}
