import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader, EmptyState } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/common";
import { CUSTOMER_LEVEL, CUSTOMER_STATUS } from "@/lib/labels";
import { formatRelative } from "@/lib/format";
import { getActiveUsers } from "@/lib/crm/queries";
import { UrlSelect } from "@/components/crm/url-select";
import { CustomerDialog } from "@/components/crm/customer-dialog";
import { MobileCard, MobileList } from "@/components/mobile/mobile-list";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function CustomersPage({ searchParams }: PageProps<"/crm/customers">) {
  const user = await requireUser();
  const canEdit = can(user, "crm:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const level = str(sp.level);
  const owner = str(sp.owner);

  const where: Prisma.CustomerWhereInput = {
    ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }, { industry: { contains: q } }] } : {}),
    ...(status in CUSTOMER_STATUS ? { status: status as keyof typeof CUSTOMER_STATUS } : {}),
    ...(level ? { level } : {}),
    ...(owner === "none" ? { ownerId: null } : owner ? { ownerId: owner } : {}),
  };
  const [rows, total, users] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: [{ code: "desc" }],
      include: {
        owner: { select: { name: true, avatarColor: true } },
        followUps: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        _count: { select: { opportunities: true, contacts: true } },
      },
    }),
    db.customer.count(),
    getActiveUsers(),
  ]);
  const filtered = !!(q || status || level || owner);

  return (
    <>
      <TopBar
        crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "客户" }]}
        actions={
          canEdit && (
            <CustomerDialog
              users={users}
              defaultOwnerId={user.id}
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建客户
                </Button>
              }
            />
          )
        }
      />
      <Page wide>
        <PageHeader icon="🏢" title="客户" description={`共 ${total} 个客户，管理联系人、商机与跟进`} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="搜索名称、编码、电话、行业" className="w-64" />
          <UrlSelect param="status" placeholder="全部状态" options={Object.entries(CUSTOMER_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
          <UrlSelect param="level" placeholder="全部等级" options={Object.entries(CUSTOMER_LEVEL).map(([k, v]) => ({ value: k, label: v.label }))} />
          <UrlSelect param="owner" placeholder="全部负责人" options={[...users.map((u) => ({ value: u.id, label: u.name })), { value: "none", label: "未分配" }]} />
          {filtered && (
            <Link href="/crm/customers" className="text-[13px] text-ink-2 hover:text-accent">
              清除筛选
            </Link>
          )}
          <span className="ml-auto text-xs text-ink-3">{rows.length} 条结果</span>
        </div>
        {total === 0 ? (
          <EmptyState icon="🏢" title="还没有客户" description="从新建第一个客户开始，记录联系人和跟进情况。" />
        ) : (
          <>
          <MobileList empty="没有符合条件的客户">
            {rows.map((c) => (
              <MobileCard
                key={c.id}
                href={`/crm/customers/${c.id}`}
                title={c.name}
                badge={<StatusBadge map={CUSTOMER_STATUS} value={c.status} />}
                subtitle={[c.code, c.industry].filter(Boolean).join(" · ")}
                meta={
                  <>
                    <UserChip name={c.owner?.name} color={c.owner?.avatarColor} />
                    <StatusBadge map={CUSTOMER_LEVEL} value={c.level as keyof typeof CUSTOMER_LEVEL} />
                    <span className="text-ink-3">{c.followUps[0] ? `${formatRelative(c.followUps[0].createdAt)}跟进` : "未跟进"}</span>
                  </>
                }
                aside={<span className="text-[13px] font-normal text-ink-2">商机 {c._count.opportunities}</span>}
              />
            ))}
          </MobileList>
          <Table className="max-md:hidden">
            <THead>
              <TR>
                <TH>编码</TH>
                <TH>客户名称</TH>
                <TH>行业</TH>
                <TH>等级</TH>
                <TH>状态</TH>
                <TH>负责人</TH>
                <TH>电话</TH>
                <TH className="text-right">商机</TH>
                <TH>最近跟进</TH>
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 && <TEmpty colSpan={9}>没有符合条件的客户</TEmpty>}
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-xs text-ink-2">{c.code}</TD>
                  <TD>
                    <Link href={`/crm/customers/${c.id}`} className="font-medium hover:text-accent hover:underline">
                      {c.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-2">{c.industry ?? "—"}</TD>
                  <TD>
                    <StatusBadge map={CUSTOMER_LEVEL} value={c.level as keyof typeof CUSTOMER_LEVEL} />
                  </TD>
                  <TD>
                    <StatusBadge map={CUSTOMER_STATUS} value={c.status} />
                  </TD>
                  <TD>
                    <UserChip name={c.owner?.name} color={c.owner?.avatarColor} />
                  </TD>
                  <TD className="tabular-nums text-ink-2">{c.phone ?? "—"}</TD>
                  <TD className="text-right tabular-nums text-ink-2">{c._count.opportunities}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{c.followUps[0] ? formatRelative(c.followUps[0].createdAt) : <span className="text-ink-3">未跟进</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          </>
        )}
      </Page>
    </>
  );
}
