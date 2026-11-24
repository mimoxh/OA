import Link from "next/link";
import { LayoutGrid, List, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader, EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { AvatarStack, UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { PROJECT_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { getActiveUsers } from "@/lib/crm/queries";
import { ViewSwitch, hrefWith } from "@/components/crm/view-switch";
import { ProjectDialog } from "@/components/pms/project-dialog";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function Progress({ done, total, color }: { done: number; total: number; color: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-2">
        {done}/{total} · {pct}%
      </span>
    </div>
  );
}

function Dates({ start, end }: { start: Date | null; end: Date | null }) {
  if (!start && !end) return <span className="text-ink-3">未设置日期</span>;
  return (
    <span className="tabular-nums">
      {start ? formatDate(start) : "?"} → {end ? formatDate(end) : "?"}
    </span>
  );
}

export default async function ProjectsPage({ searchParams }: PageProps<"/pms">) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = str(sp.view) === "list" ? "list" : "card";
  const status = str(sp.status);
  const q = str(sp.q).trim();

  const where: Prisma.ProjectWhereInput = {
    ...(status in PROJECT_STATUS ? { status: status as keyof typeof PROJECT_STATUS } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}),
  };
  const [projects, statusCounts, taskCounts, users, customers] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        owner: { select: { name: true, avatarColor: true } },
        customer: { select: { id: true, name: true } },
        members: { include: { user: { select: { name: true, avatarColor: true } } }, orderBy: { id: "asc" } },
      },
    }),
    db.project.groupBy({ by: ["status"], _count: { _all: true } }),
    db.task.groupBy({ by: ["projectId", "status"], where: { parentId: null }, _count: { _all: true } }),
    getActiveUsers(),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } }),
  ]);

  const progress = (pid: string) => {
    const rows = taskCounts.filter((t) => t.projectId === pid);
    return {
      total: rows.reduce((s, r) => s + r._count._all, 0),
      done: rows.filter((r) => r.status === "DONE").reduce((s, r) => s + r._count._all, 0),
    };
  };
  const total = statusCounts.reduce((s, r) => s + r._count._all, 0);
  const canCreate = can(user, "pms:edit");
  const filtered = !!(status || q);
  const createButton = canCreate && (
    <ProjectDialog
      users={users}
      customers={customers}
      currentUserId={user.id}
      trigger={
        <Button variant="primary">
          <Plus className="size-3.5" />
          新建项目
        </Button>
      }
    />
  );

  return (
    <>
      <TopBar crumbs={[{ label: "PMS 项目", href: "/pms" }, { label: "全部项目" }]} actions={createButton} />
      <Page wide>
        <PageHeader icon="🗂️" title="项目" description={`共 ${total} 个项目，跟踪任务、里程碑与工时`} />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterPills
            options={Object.entries(PROJECT_STATUS).map(([k, v]) => ({
              value: k,
              label: v.label,
              count: statusCounts.find((s) => s.status === k)?._count._all ?? 0,
            }))}
          />
          <SearchInput placeholder="搜索名称或编码" className="w-52" />
          <div className="ml-auto">
            <ViewSwitch
              items={[
                { href: hrefWith("/pms", sp, { view: null }), label: "卡片", icon: <LayoutGrid />, active: view === "card" },
                { href: hrefWith("/pms", sp, { view: "list" }), label: "列表", icon: <List />, active: view === "list" },
              ]}
            />
          </div>
        </div>

        {total === 0 ? (
          <EmptyState icon="🗂️" title="还没有项目" description="新建一个项目，开始用看板管理任务。" action={createButton} />
        ) : view === "card" ? (
          projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line-strong py-10 text-center text-sm text-ink-3">
              没有符合条件的项目
              {filtered && (
                <Link href="/pms" className="ml-2 text-accent hover:underline">
                  清除筛选
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => {
                const pr = progress(p.id);
                return (
                  <Link
                    key={p.id}
                    href={`/pms/projects/${p.id}`}
                    className="group flex flex-col overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-card"
                  >
                    <div className="h-1" style={{ backgroundColor: p.color }} />
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <span
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-2xl"
                          style={{ backgroundColor: `${p.color}1f` }}
                        >
                          {p.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-ink group-hover:text-accent">{p.name}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                            <span className="truncate">{p.customer ? p.customer.name : "内部项目"}</span>
                          </div>
                        </div>
                        <StatusBadge map={PROJECT_STATUS} value={p.status} />
                      </div>
                      {p.description && <p className="line-clamp-2 text-[13px] text-ink-2">{p.description}</p>}
                      <Progress done={pr.done} total={pr.total} color={p.color} />
                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-2">
                        <UserChip name={p.owner.name} color={p.owner.avatarColor} />
                        <Dates start={p.startDate} end={p.endDate} />
                        <AvatarStack users={p.members.map((m) => m.user)} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>项目</TH>
                <TH>状态</TH>
                <TH>负责人</TH>
                <TH>成员</TH>
                <TH className="w-56">进度</TH>
                <TH>起止日期</TH>
                <TH>客户</TH>
              </TR>
            </THead>
            <TBody>
              {projects.length === 0 && <TEmpty colSpan={7}>没有符合条件的项目</TEmpty>}
              {projects.map((p) => {
                const pr = progress(p.id);
                return (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/pms/projects/${p.id}`} className="font-medium hover:text-accent hover:underline">
                        <span className="mr-1.5">{p.icon}</span>
                        {p.name}
                      </Link>
                    </TD>
                    <TD>
                      <StatusBadge map={PROJECT_STATUS} value={p.status} />
                    </TD>
                    <TD>
                      <UserChip name={p.owner.name} color={p.owner.avatarColor} />
                    </TD>
                    <TD>
                      <AvatarStack users={p.members.map((m) => m.user)} />
                    </TD>
                    <TD>
                      <Progress done={pr.done} total={pr.total} color={p.color} />
                    </TD>
                    <TD className="whitespace-nowrap text-ink-2">
                      <Dates start={p.startDate} end={p.endDate} />
                    </TD>
                    <TD className="text-ink-2">
                      {p.customer ? (
                        <Link href={`/crm/customers/${p.customer.id}`} className="hover:text-accent hover:underline">
                          {p.customer.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Page>
    </>
  );
}
