"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, FileText, FilePlus2, Pencil, Trash2, Users, UserRound, Wallet, CircleDot, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { AvatarStack, UserChip } from "@/components/ui/avatar";
import { ConfirmButton } from "@/components/ui/common";
import { Properties, Property } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { InlineSelect } from "@/components/crm/inline";
import { PROJECT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import type { UserOption } from "@/lib/crm/types";
import { createProjectDocument, deleteProject, updateProject } from "@/app/(app)/pms/actions";
import { ProjectDialog, type ProjectFormValue } from "@/components/pms/project-dialog";

export type HeaderProject = {
  id: string;
  name: string;
  status: keyof typeof PROJECT_STATUS;
  ownerId: string;
  documentId: string | null;
  customer: { id: string; name: string } | null;
  startDate: Date | null;
  endDate: Date | null;
  budget: number;
  members: { name: string; avatarColor: string }[];
  total: number;
  done: number;
  form: ProjectFormValue;
};

export function ProjectProperties({
  project: p,
  users,
  canManage,
}: {
  project: HeaderProject;
  users: UserOption[];
  canManage: boolean;
}) {
  const { run, pending } = useAction();
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <Properties>
      <Property label="状态" icon={<CircleDot />}>
        <InlineSelect
          readOnly={!canManage}
          value={p.status}
          options={(Object.keys(PROJECT_STATUS) as (keyof typeof PROJECT_STATUS)[]).map((s) => ({ value: s, label: <StatusBadge map={PROJECT_STATUS} value={s} /> }))}
          onSave={(v) => updateProject(p.id, { status: v as "ACTIVE" })}
        />
      </Property>
      <Property label="负责人" icon={<UserRound />}>
        <InlineSelect
          readOnly={!canManage}
          value={p.ownerId}
          options={users.map((u) => ({ value: u.id, label: <UserChip name={u.name} color={u.avatarColor} /> }))}
          onSave={(v) => updateProject(p.id, { ownerId: v })}
        />
      </Property>
      <Property label="成员" icon={<Users />}>
        <Link href="?view=members" scroll={false} className="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
          <AvatarStack users={p.members} max={6} />
          <span className="text-xs text-ink-2">{p.members.length} 人</span>
        </Link>
      </Property>
      <Property label="进度" icon={<BarChart3 />}>
        <span className="flex w-72 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
            <span className="block h-full rounded-full bg-[#448361]" style={{ width: `${pct}%` }} />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-ink-2">
            {p.done}/{p.total} · {pct}%
          </span>
        </span>
      </Property>
      <Property label="周期" icon={<CalendarDays />}>
        <span className="text-ink-2">
          {formatDate(p.startDate)} → {formatDate(p.endDate)}
        </span>
      </Property>
      <Property label="客户" icon={<Building2 />}>
        {p.customer ? (
          <Link href={`/crm/customers/${p.customer.id}`} className="hover:text-accent hover:underline">
            🏢 {p.customer.name}
          </Link>
        ) : (
          <span className="text-ink-3">内部项目</span>
        )}
      </Property>
      <Property label="预算" icon={<Wallet />}>
        <span className="tabular-nums">{p.budget ? formatMoney(p.budget) : <span className="text-ink-3">未设置</span>}</span>
      </Property>
      <Property label="项目文档" icon={<FileText />}>
        {p.documentId ? (
          <Link href={`/docs/${p.documentId}`} className="inline-flex items-center gap-1 hover:text-accent hover:underline">
            📄 {p.name} 项目文档
          </Link>
        ) : canManage ? (
          <Button size="xs" variant="ghost" loading={pending} onClick={() => run(() => createProjectDocument(p.id), { success: "项目文档已创建" })}>
            <FilePlus2 className="size-3.5" />
            创建项目文档
          </Button>
        ) : (
          <span className="text-ink-3">无</span>
        )}
      </Property>
    </Properties>
  );
}

export function ProjectActions({
  project: p,
  users,
  customers,
  canManage,
  canDelete,
  currentUserId,
}: {
  project: HeaderProject;
  users: UserOption[];
  customers: { id: string; name: string }[];
  canManage: boolean;
  canDelete: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <>
      {canManage && (
        <ProjectDialog
          users={users}
          customers={customers}
          projectId={p.id}
          initial={p.form}
          currentUserId={currentUserId}
          trigger={
            <Button size="sm">
              <Pencil className="size-3.5" />
              编辑
            </Button>
          }
        />
      )}
      {canDelete && (
        <ConfirmButton
          danger
          title="删除项目"
          description={`确定删除项目「${p.name}」吗？所有任务、里程碑、工时记录将一并删除，此操作不可恢复。`}
          confirmText="删除项目"
          onConfirm={() => run(() => deleteProject(p.id), { success: "项目已删除", refresh: false, onSuccess: () => router.push("/pms") })}
        >
          <Trash2 className="size-3.5" />
        </ConfirmButton>
      )}
    </>
  );
}
