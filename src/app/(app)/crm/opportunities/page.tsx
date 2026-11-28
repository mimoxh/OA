import Link from "next/link";
import { KanbanSquare, List, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/common";
import { OPPORTUNITY_STAGE } from "@/lib/labels";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { getActiveUsers } from "@/lib/crm/queries";
import { UrlSelect } from "@/components/crm/url-select";
import { OpportunityBoard } from "@/components/crm/opportunity-board";
import { OpportunityDialog } from "@/components/crm/opportunity-dialog";
import { ViewSwitch, hrefWith } from "@/components/crm/view-switch";
import { MobileCard, MobileField, MobileList } from "@/components/mobile/mobile-list";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function OpportunitiesPage({ searchParams }: PageProps<"/crm/opportunities">) {
  const user = await requireUser();
  const canEdit = can(user, "crm:edit");
  const sp = await searchParams;
  const view = str(sp.view) === "list" ? "list" : "board";
  const q = str(sp.q).trim();
  const owner = str(sp.owner);
  const stage = str(sp.stage);

  const where: Prisma.OpportunityWhereInput = {
    ...(q ? { OR: [{ name: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
    ...(owner === "mine" ? { ownerId: user.id } : owner ? { ownerId: owner } : {}),
    ...(view === "list" && stage in OPPORTUNITY_STAGE ? { stage: stage as keyof typeof OPPORTUNITY_STAGE } : {}),
  };
  const [rows, users, customers] = await Promise.all([
    db.opportunity.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      include: { customer: { select: { id: true, name: true } }, owner: { select: { name: true, avatarColor: true } } },
    }),
    getActiveUsers(),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const open = rows.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
  const path = "/crm/opportunities";

  return (
    <>
      <TopBar
        crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "商机" }]}
        actions={
          canEdit && (
            <OpportunityDialog
              customers={customers}
              users={users}
              defaultOwnerId={user.id}
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建商机
                </Button>
              }
            />
          )
        }
      />
      <Page wide>
        <PageHeader
          icon="💡"
          title="商机"
          description={`进行中 ${open.length} 个，合计 ${formatMoney(open.reduce((s, o) => s + o.amount, 0))}${canEdit && view === "board" ? "，拖动卡片即可变更阶段" : ""}`}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ViewSwitch
            items={[
              { href: hrefWith(path, sp, { view: null, stage: null }), label: "看板", icon: <KanbanSquare />, active: view === "board" },
              { href: hrefWith(path, sp, { view: "list" }), label: "列表", icon: <List />, active: view === "list" },
            ]}
          />
          <SearchInput placeholder="搜索商机或客户" />
          <UrlSelect
            param="owner"
            placeholder="全部负责人"
            options={[{ value: "mine", label: "我负责的" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          {view === "list" && (
            <UrlSelect param="stage" placeholder="全部阶段" options={Object.entries(OPPORTUNITY_STAGE).map(([k, v]) => ({ value: k, label: v.label }))} />
          )}
        </div>

        {view === "board" ? (
          <OpportunityBoard items={rows} canEdit={canEdit} customers={customers} users={users} currentUserId={user.id} />
        ) : (
          <>
          <MobileList empty="没有符合条件的商机">
            {rows.map((o) => (
              <MobileCard
                key={o.id}
                href={`/crm/opportunities/${o.id}`}
                title={o.name}
                badge={<StatusBadge map={OPPORTUNITY_STAGE} value={o.stage} />}
                subtitle={o.customer.name}
                meta={
                  <>
                    <UserChip name={o.owner?.name} color={o.owner?.avatarColor} />
                    <MobileField label="预计">{formatDate(o.expectedCloseDate)}</MobileField>
                    <span className="text-ink-3">赢率 {o.probability}%</span>
                  </>
                }
                aside={formatMoney(o.amount)}
              />
            ))}
            {rows.length > 0 && (
              <li className="flex items-center justify-between px-1 pt-1 text-[13px] text-ink-2">
                <span>合计 {rows.length} 个</span>
                <span className="font-semibold tabular-nums text-ink">{formatMoney(rows.reduce((s, o) => s + o.amount, 0))}</span>
              </li>
            )}
          </MobileList>
          <Table className="max-md:hidden">
            <THead>
              <TR>
                <TH>商机</TH>
                <TH>客户</TH>
                <TH>阶段</TH>
                <TH className="text-right">金额</TH>
                <TH className="text-right">赢率</TH>
                <TH>预计成交</TH>
                <TH>负责人</TH>
                <TH>更新</TH>
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 && <TEmpty colSpan={8}>没有符合条件的商机</TEmpty>}
              {rows.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/crm/opportunities/${o.id}`} className="font-medium hover:text-accent hover:underline">
                      {o.name}
                    </Link>
                  </TD>
                  <TD>
                    <Link href={`/crm/customers/${o.customer.id}`} className="text-ink-2 hover:text-accent">
                      {o.customer.name}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={OPPORTUNITY_STAGE} value={o.stage} />
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(o.amount)}</TD>
                  <TD className="text-right tabular-nums text-ink-2">{o.probability}%</TD>
                  <TD className="text-ink-2">{formatDate(o.expectedCloseDate)}</TD>
                  <TD>
                    <UserChip name={o.owner?.name} color={o.owner?.avatarColor} />
                  </TD>
                  <TD className="whitespace-nowrap text-ink-3">{formatRelative(o.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="text-sm">
                  <td colSpan={3} className="py-2 text-ink-2">
                    合计 {rows.length} 个
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums">{formatMoney(rows.reduce((s, o) => s + o.amount, 0))}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </Table>
          </>
        )}
      </Page>
    </>
  );
}
