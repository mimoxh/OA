import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { TRANSPORT_STATUS } from "@/lib/labels";
import { getDriverByUser } from "@/lib/tms/queries";
import { pageNum, str } from "@/lib/wms/params";
import { StatusBadge } from "@/components/ui/badge";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { NewTransportButton } from "@/components/tms/new-transport";
import { Pagination } from "@/components/wms/pagination";
import { UrlToggle } from "@/components/wms/url-filters";

const PAGE_SIZE = 20;

export default async function TransportOrdersPage({ searchParams }: PageProps<"/tms/orders">) {
  const user = await requireUser();
  const canDispatch = can(user, "tms:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const mine = str(sp.mine) === "1";
  const page = pageNum(sp.page);
  const me = await getDriverByUser(user.id);

  const base: Prisma.TransportOrderWhereInput = {
    ...(mine && me ? { driverId: me.id } : {}),
    ...(q
      ? {
          OR: [
            { no: { contains: q } },
            { origin: { contains: q } },
            { destination: { contains: q } },
            { consignee: { contains: q } },
            { customer: { name: { contains: q } } },
            { vehicle: { plateNo: { contains: q } } },
            { driver: { name: { contains: q } } },
          ],
        }
      : {}),
  };
  const where: Prisma.TransportOrderWhereInput = {
    ...base,
    ...(status && status in TRANSPORT_STATUS ? { status: status as keyof typeof TRANSPORT_STATUS } : {}),
  };
  const [rows, total, counts, customers, warehouses] = await Promise.all([
    db.transportOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { id: true, name: true } },
        vehicle: { select: { plateNo: true } },
        driver: { select: { name: true } },
      },
    }),
    db.transportOrder.count({ where }),
    db.transportOrder.groupBy({ by: ["status"], where: base, _count: true }),
    canDispatch
      ? db.customer.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, address: true, phone: true, contacts: { where: { isPrimary: true }, select: { name: true }, take: 1 } },
        })
      : Promise.resolve([]),
    canDispatch ? db.warehouse.findMany({ where: { active: true }, select: { name: true, address: true } }) : Promise.resolve([]),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <TopBar
        crumbs={[{ label: "TMS 运输", href: "/tms" }, { label: "运输单" }]}
        actions={
          canDispatch ? (
            <NewTransportButton
              customers={customers.map((c) => ({ id: c.id, name: c.name, address: c.address, phone: c.phone, contact: c.contacts[0]?.name ?? null }))}
              origins={warehouses.map((w) => w.address || w.name)}
            />
          ) : null
        }
      />
      <Page wide>
        <PageHeader icon="📋" title="运输单" description="销售出库发货后自动生成运输单，也可手工创建" />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterPills options={Object.entries(TRANSPORT_STATUS).map(([value, m]) => ({ value, label: m.label, count: countOf(value) }))} />
          <div className="flex-1" />
          {me && <UrlToggle param="mine" label="只看我的任务" />}
          <SearchInput placeholder="单号 / 地址 / 客户 / 车牌 / 司机" className="w-64" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>单号</TH>
              <TH>状态</TH>
              <TH>起点 → 终点</TH>
              <TH>收货人</TH>
              <TH className="text-right">重量</TH>
              <TH>车辆</TH>
              <TH>司机</TH>
              <TH className="text-right">运费</TH>
              <TH>计划时间</TH>
              <TH>签收时间</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && <TEmpty colSpan={10}>暂无运输单</TEmpty>}
            {rows.map((o) => (
              <TR key={o.id}>
                <TD>
                  <Link href={`/tms/orders/${o.id}`} className="font-medium tabular-nums text-ink hover:text-accent hover:underline">
                    {o.no}
                  </Link>
                </TD>
                <TD>
                  <StatusBadge map={TRANSPORT_STATUS} value={o.status} />
                </TD>
                <TD className="max-w-72">
                  <div className="truncate" title={o.origin}>
                    {o.origin}
                  </div>
                  <div className="truncate text-xs text-ink-2" title={o.destination}>
                    → {o.destination}
                  </div>
                </TD>
                <TD className="whitespace-nowrap">
                  <div>{o.consignee ?? "—"}</div>
                  {o.customer && <div className="max-w-40 truncate text-xs text-ink-3">{o.customer.name}</div>}
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{formatNumber(o.weight, 1)} kg</TD>
                <TD className="whitespace-nowrap">{o.vehicle?.plateNo ?? <span className="text-ink-3">—</span>}</TD>
                <TD className="whitespace-nowrap">{o.driver?.name ?? <span className="text-ink-3">—</span>}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{o.freightCost ? formatMoney(o.freightCost) : "—"}</TD>
                <TD className="whitespace-nowrap tabular-nums text-ink-2">{formatDateTime(o.plannedAt)}</TD>
                <TD className="whitespace-nowrap tabular-nums text-ink-2">{formatDateTime(o.deliveredAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination basePath="/tms/orders" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
      </Page>
    </>
  );
}
