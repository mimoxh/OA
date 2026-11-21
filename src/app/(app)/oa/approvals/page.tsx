import Link from "next/link";
import { Plus } from "lucide-react";
import type { ApprovalStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { APPROVAL_STATUS } from "@/lib/labels";
import { formatDateTime, formatRelative } from "@/lib/format";
import { approvalTabWhere, canSeeAllApprovals, type ApprovalTab } from "@/lib/oa/server";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { AvatarStack, UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { QueryTabs } from "@/components/oa/query-tabs";
import { UrlSelect } from "@/components/oa/url-select";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const EMPTY: Record<ApprovalTab, string> = {
  todo: "太棒了，没有待你审批的事项",
  done: "你还没有处理过审批",
  mine: "你还没有发起过审批",
  all: "暂无审批记录",
};

export default async function ApprovalsPage({ searchParams }: PageProps<"/oa/approvals">) {
  const user = await requireUser();
  const sp = await searchParams;
  const showAll = canSeeAllApprovals(user);
  let tab = (str(sp.tab) || "todo") as ApprovalTab;
  if (!["todo", "done", "mine", "all"].includes(tab) || (tab === "all" && !showAll)) tab = "todo";
  const q = str(sp.q).trim();
  const flowKey = str(sp.flow);
  const status = str(sp.status);
  const validStatus = status in APPROVAL_STATUS ? (status as ApprovalStatus) : undefined;

  const where: Prisma.ApprovalInstanceWhereInput = {
    AND: [
      approvalTabWhere(tab, user.id),
      q ? { OR: [{ title: { contains: q } }, { no: { contains: q } }, { applicant: { name: { contains: q } } }] } : {},
      flowKey ? { flow: { key: flowKey } } : {},
      validStatus ? { status: validStatus } : {},
    ],
  };

  const [rows, todoCount, flows] = await Promise.all([
    db.approvalInstance.findMany({
      where,
      include: {
        flow: { select: { name: true, icon: true } },
        applicant: { select: { name: true, avatarColor: true } },
        tasks: { include: { approver: { select: { id: true, name: true, avatarColor: true } } }, orderBy: { step: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.approvalInstance.count({ where: approvalTabWhere("todo", user.id) }),
    db.approvalFlow.findMany({ orderBy: { createdAt: "asc" }, select: { key: true, name: true, icon: true } }),
  ]);

  const tabs = [
    { value: "todo", label: "待我审批", count: todoCount },
    { value: "done", label: "我已审批" },
    { value: "mine", label: "我发起的" },
    ...(showAll ? [{ value: "all", label: "全部审批" }] : []),
  ];

  return (
    <>
      <TopBar
        crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "审批中心" }]}
        actions={
          <LinkButton href="/oa/approvals/new" variant="primary">
            <Plus className="size-3.5" />
            发起审批
          </LinkButton>
        }
      />
      <Page wide>
        <PageHeader icon="✅" title="审批中心" description="处理待办审批，跟踪你发起的申请进度" />
        <QueryTabs items={tabs} defaultValue="todo" />
        <div className="flex flex-wrap items-center gap-2 py-3">
          <SearchInput placeholder="搜索标题、编号、申请人…" />
          <UrlSelect
            param="flow"
            placeholder="全部流程"
            options={flows.map((f) => ({ value: f.key, label: `${f.icon} ${f.name}` }))}
          />
          {tab !== "todo" && (
            <FilterPills
              options={Object.entries(APPROVAL_STATUS).map(([value, m]) => ({ value, label: m.label }))}
            />
          )}
          <span className="ml-auto text-xs text-ink-3">共 {rows.length} 条</span>
        </div>
        {rows.length === 0 ? (

                <EmptyState
                  icon="📭"
                  title={q || flowKey || status ? "没有符合条件的审批" : EMPTY[tab]}
                  action={
                    tab === "mine" ? (
                      <LinkButton href="/oa/approvals/new" variant="primary">
                        发起审批
                      </LinkButton>
                    ) : undefined
                  }
                />
        ) : (
        <Table>
          <THead>
            <TR>
              <TH>标题</TH>
              <TH>流程</TH>
              <TH>申请人</TH>
              <TH>当前节点</TH>
              {tab === "done" && <TH>我的处理</TH>}
              <TH>状态</TH>
              <TH>编号</TH>
              <TH className="text-right">提交时间</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const pending = r.tasks.filter((t) => t.status === "PENDING");
              const mine = r.tasks.filter((t) => t.approverId === user.id && (t.status === "APPROVED" || t.status === "REJECTED")).at(-1);
              return (
                <TR key={r.id}>
                  <TD className="max-w-[320px]">
                    <Link href={`/oa/approvals/${r.id}`} className="block truncate font-medium hover:underline">
                      {r.title}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <span className="mr-1">{r.flow.icon}</span>
                    {r.flow.name}
                  </TD>
                  <TD>
                    <UserChip name={r.applicant.name} color={r.applicant.avatarColor} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    {r.status === "PENDING" && pending.length ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AvatarStack users={pending.map((t) => t.approver)} max={3} />
                        <span className="text-ink-2">{pending[0].stepName}</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">已结束</span>
                    )}
                  </TD>
                  {tab === "done" && (
                    <TD>
                      {mine ? <Badge color={mine.status === "APPROVED" ? "green" : "red"}>{mine.status === "APPROVED" ? "已同意" : "已驳回"}</Badge> : "—"}
                    </TD>
                  )}
                  <TD>
                    <StatusBadge map={APPROVAL_STATUS} value={r.status} />
                  </TD>
                  <TD className="whitespace-nowrap font-mono text-xs text-ink-2">{r.no}</TD>
                  <TD className="whitespace-nowrap text-right text-ink-2" title={formatDateTime(r.createdAt)}>
                    {formatRelative(r.createdAt)}
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
