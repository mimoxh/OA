import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { DRIVER_STATUS, TRANSPORT_STATUS } from "@/lib/labels";
import { str } from "@/lib/wms/params";
import { UserChip } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { DriverDialog, DriverRowActions } from "@/components/tms/master-forms";

export default async function DriversPage({ searchParams }: PageProps<"/tms/drivers">) {
  const user = await requireUser();
  const canEdit = can(user, "tms:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const [drivers, counts, users] = await Promise.all([
    db.driver.findMany({
      where: {
        ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { licenseNo: { contains: q } }] } : {}),
        ...(status && status in DRIVER_STATUS ? { status: status as keyof typeof DRIVER_STATUS } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true, email: true, avatarColor: true } },
        _count: { select: { orders: true } },
        orders: {
          where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] } },
          orderBy: { plannedAt: "asc" },
          select: { id: true, no: true, status: true, destination: true, vehicle: { select: { plateNo: true } } },
        },
      },
    }),
    db.driver.groupBy({ by: ["status"], _count: true }),
    canEdit ? db.user.findMany({ where: { active: true, isBot: false }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <TopBar
        crumbs={[{ label: "TMS 运输", href: "/tms" }, { label: "司机" }]}
        actions={
          canEdit ? (
            <DriverDialog
              users={users}
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建司机
                </Button>
              }
            />
          ) : null
        }
      />
      <Page>
        <PageHeader icon="🧑‍✈️" title="司机" description="司机档案；关联系统账号后，司机可以在系统中执行自己的运输任务" />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterPills options={Object.entries(DRIVER_STATUS).map(([value, m]) => ({ value, label: m.label, count: countOf(value) }))} />
          <div className="flex-1" />
          <SearchInput placeholder="姓名 / 电话 / 驾驶证号" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>姓名</TH>
              <TH>电话</TH>
              <TH>驾驶证号</TH>
              <TH>状态</TH>
              <TH>系统账号</TH>
              <TH>当前任务</TH>
              <TH className="text-right">历史运输单</TH>
              {canEdit && <TH className="w-16" />}
            </TR>
          </THead>
          <TBody>
            {drivers.length === 0 && <TEmpty colSpan={canEdit ? 8 : 7}>暂无司机</TEmpty>}
            {drivers.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">{d.name}</TD>
                <TD className="tabular-nums">{d.phone}</TD>
                <TD className="font-mono text-xs text-ink-2">{d.licenseNo ?? "—"}</TD>
                <TD>
                  <StatusBadge map={DRIVER_STATUS} value={d.status} />
                </TD>
                <TD>
                  {d.user ? (
                    <span title={d.user.email}>
                      <UserChip name={d.user.name} color={d.user.avatarColor} />
                    </span>
                  ) : (
                    <span className="text-ink-3">未关联</span>
                  )}
                </TD>
                <TD>
                  {d.orders.length === 0 ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <div className="space-y-0.5">
                      {d.orders.map((o) => (
                        <Link key={o.id} href={`/tms/orders/${o.id}`} className="flex items-center gap-1.5 text-[13px] hover:underline">
                          <StatusBadge map={TRANSPORT_STATUS} value={o.status} />
                          <span className="tabular-nums text-accent">{o.no}</span>
                          {o.vehicle && <span className="text-xs text-ink-3">{o.vehicle.plateNo}</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </TD>
                <TD className="text-right tabular-nums">{d._count.orders}</TD>
                {canEdit && (
                  <TD>
                    <DriverRowActions
                      driver={{ id: d.id, name: d.name, phone: d.phone, licenseNo: d.licenseNo, status: d.status, userId: d.userId }}
                      users={users}
                    />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Page>
    </>
  );
}
