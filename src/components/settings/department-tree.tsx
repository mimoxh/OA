"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Building2, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Card, EmptyState } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { MemberSelect } from "@/components/oa/member-picker";
import type { MemberOption } from "@/lib/oa/types";
import { cn } from "@/lib/utils";
import { deleteDepartment, saveDepartment, setDepartmentManager } from "@/app/(app)/settings/actions";
import { deptOptionLabel, flattenDepartments } from "./dept-utils";

export type DeptItem = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  managerId: string | null;
  memberCount: number;
};

export type DeptMember = { id: string; name: string; avatarColor: string; title: string | null; departmentId: string | null; roleName: string; active: boolean };

type DialogState = { mode: "create"; parentId: string | null } | { mode: "edit"; dept: DeptItem } | null;

export function DepartmentTree({
  departments,
  users,
  members,
  selectedId,
}: {
  departments: DeptItem[];
  users: DeptMember[];
  members: MemberOption[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { run } = useAction();
  const flat = useMemo(() => flattenDepartments(departments), [departments]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const byId = new Map(departments.map((d) => [d.id, d]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const childrenOf = (id: string) => departments.filter((d) => d.parentId === id);

  const hidden = (d: DeptItem): boolean => {
    let p = d.parentId ? byId.get(d.parentId) : undefined;
    while (p) {
      if (collapsed[p.id]) return true;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return false;
  };

  const selected = (selectedId && byId.get(selectedId)) || flat[0];
  const select = (id: string) => router.replace(`${pathname}?dept=${id}`, { scroll: false });
  const path = (d: DeptItem) => {
    const out: string[] = [];
    let cur: DeptItem | undefined = d;
    while (cur) {
      out.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out.join(" / ");
  };
  const deptUsers = selected ? users.filter((u) => u.departmentId === selected.id) : [];
  const subCount = selected ? childrenOf(selected.id).length : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit p-1.5">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-medium text-ink-3">组织架构</span>
          <Button size="xs" variant="ghost" onClick={() => setDialog({ mode: "create", parentId: null })}>
            <Plus className="size-3" />
            新建部门
          </Button>
        </div>
        {flat.length === 0 && <div className="px-2 py-6 text-center text-[13px] text-ink-3">还没有部门</div>}
        {flat
          .filter((d) => !hidden(d))
          .map((d) => {
            const hasChildren = childrenOf(d.id).length > 0;
            const manager = d.managerId ? memberById.get(d.managerId) : undefined;
            return (
              <div
                key={d.id}
                onClick={() => select(d.id)}
                className={cn(
                  "group flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-hover",
                  selected?.id === d.id && "bg-active/70",
                )}
                style={{ paddingLeft: 4 + d.depth * 18 }}
              >
                <button
                  type="button"
                  aria-label={collapsed[d.id] ? "展开" : "收起"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed((c) => ({ ...c, [d.id]: !c[d.id] }));
                  }}
                  className={cn("flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active", !hasChildren && "invisible")}
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", !collapsed[d.id] && "rotate-90")} />
                </button>
                <Building2 className="size-3.5 shrink-0 text-ink-3" />
                <span className={cn("min-w-0 flex-1 truncate", selected?.id === d.id ? "font-medium text-ink" : "text-ink")}>{d.name}</span>
                <span className="text-xs tabular-nums text-ink-3">{d.memberCount}</span>
                {manager && <Avatar name={manager.name} color={manager.avatarColor} size={18} className="ml-1" />}
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton aria-label="更多操作" onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                      <MoreHorizontal className="size-3.5" />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <MenuItem icon={<Plus />} onSelect={() => setDialog({ mode: "create", parentId: d.id })}>
                      新建子部门
                    </MenuItem>
                    <MenuItem icon={<Pencil />} onSelect={() => setDialog({ mode: "edit", dept: d })}>
                      重命名 / 设置负责人
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            );
          })}
      </Card>

      {selected ? (
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-ink-3">{path(selected)}</div>
              <h2 className="mt-0.5 text-xl font-semibold text-ink">{selected.name}</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <Button onClick={() => setDialog({ mode: "create", parentId: selected.id })}>
                <Plus className="size-3.5" />
                子部门
              </Button>
              <Button onClick={() => setDialog({ mode: "edit", dept: selected })}>
                <Pencil className="size-3.5" />
                编辑
              </Button>
              <ConfirmButton
                danger
                title={`删除「${selected.name}」`}
                description={
                  subCount || selected.memberCount
                    ? `该部门下还有${subCount ? ` ${subCount} 个子部门` : ""}${selected.memberCount ? ` ${selected.memberCount} 名成员` : ""}，需先移走后才能删除。`
                    : "删除后不可恢复。"
                }
                confirmText="删除"
                disabled={subCount > 0 || selected.memberCount > 0}
                onConfirm={() => run(() => deleteDepartment(selected.id), { success: "部门已删除", onSuccess: () => router.replace(pathname) })}
              >
                <Trash2 className="size-3.5" />
                删除
              </ConfirmButton>
            </div>
          </div>
          <div className="mt-5 grid max-w-md grid-cols-[100px_1fr] items-center gap-y-3 text-sm">
            <span className="text-ink-2">负责人</span>
            <MemberSelect
              members={members}
              value={selected.managerId}
              placeholder="未设置负责人"
              onChange={(id) => run(() => setDepartmentManager(selected.id, id), { success: id ? "负责人已更新" : "已清除负责人" })}
            />
            <span className="text-ink-2">子部门</span>
            <span className="text-ink">{subCount} 个</span>
            <span className="text-ink-2">成员</span>
            <span className="text-ink">{selected.memberCount} 人</span>
          </div>
          <h3 className="mb-2 mt-8 text-[13px] font-semibold text-ink">部门成员</h3>
          {deptUsers.length === 0 ? (
            <EmptyState title="该部门暂无成员" description="在「成员」页面编辑成员即可调整所属部门" />
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {deptUsers.map((u) => (
                <Link key={u.id} href={`/settings/members?user=${u.id}`} className={cn("flex items-center gap-3 px-3 py-2 hover:bg-sidebar", !u.active && "opacity-50")}>
                  <UserChip name={u.name} color={u.avatarColor} />
                  {u.id === selected.managerId && <span className="rounded bg-tag-orange px-1 text-[11px] text-tag-orange-ink">负责人</span>}
                  <span className="text-[13px] text-ink-2">{u.title}</span>
                  <span className="ml-auto text-xs text-ink-3">{u.roleName}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="选择左侧部门查看详情" />
      )}

      {dialog && (
        <DepartmentDialog
          key={dialog.mode === "edit" ? dialog.dept.id : `new-${dialog.parentId}`}
          state={dialog}
          departments={flat}
          members={members}
          onClose={() => setDialog(null)}
          onCreated={(id) => select(id)}
        />
      )}
    </div>
  );
}

function DepartmentDialog({
  state,
  departments,
  members,
  onClose,
  onCreated,
}: {
  state: NonNullable<DialogState>;
  departments: (DeptItem & { depth: number })[];
  members: MemberOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { run, pending } = useAction();
  const edit = state.mode === "edit" ? state.dept : null;
  const [name, setName] = useState(edit?.name ?? "");
  const [parentId, setParentId] = useState(edit ? (edit.parentId ?? "") : (state.mode === "create" ? (state.parentId ?? "") : ""));
  const [managerId, setManagerId] = useState<string | null>(edit?.managerId ?? null);

  const blocked = new Set<string>();
  if (edit) {
    blocked.add(edit.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of departments) if (d.parentId && blocked.has(d.parentId) && !blocked.has(d.id)) {
        blocked.add(d.id);
        changed = true;
      }
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="sm"
        title={edit ? "编辑部门" : "新建部门"}
        footer={
          <>
            <Button onClick={onClose}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => saveDepartment({ id: edit?.id, name, parentId: parentId || undefined, managerId: managerId || undefined }), {
                  success: edit ? "部门已更新" : "部门已创建",
                  onSuccess: (d) => {
                    onClose();
                    if (!edit) onCreated(d.id);
                  },
                })
              }
            >
              {edit ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2">
          <Field label="部门名称" required>
            <Input autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="上级部门">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">无（顶级部门）</option>
              {departments
                .filter((d) => !blocked.has(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {deptOptionLabel(d)}
                  </option>
                ))}
            </Select>
          </Field>
          <div>
            <span className="mb-1 block text-xs font-medium text-ink-2">负责人</span>
            <MemberSelect members={members} value={managerId} onChange={setManagerId} placeholder="选择负责人（审批时的直属主管）" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
