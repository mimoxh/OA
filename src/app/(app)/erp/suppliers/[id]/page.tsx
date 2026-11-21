import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { INVOICE_STATUS, PURCHASE_STATUS } from "@/lib/labels";
import { round2 } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, StatCard, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { RatingStars } from "@/components/erp/rating-stars";
import { SupplierDialog } from "@/components/erp/supplier-dialog";
import { ActionButton } from "@/components/erp/action-button";
import { deleteSupplier } from "@/app/(app)/erp/actions";

export default async function SupplierDetailPage({ params }: PageProps<"/erp/suppliers/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: { include: { warehouse: true, createdBy: true }, orderBy: { createdAt: "desc" } },
      invoices: { include: { purchaseOrder: { select: { id: true, no: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!supplier) notFound();

  const active = supplier.purchaseOrders.filter((p) => !["DRAFT", "CANCELLED", "REJECTED"].includes(p.status));
  const totalPurchase = round2(active.reduce((s, p) => s + p.totalAmount, 0));
  const openInvoices = supplier.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
  const unpaid = round2(openInvoices.reduce((s, i) => s + i.amount - i.paidAmount, 0));
  const paid = round2(supplier.invoices.filter((i) => i.status !== "VOID").reduce((s, i) => s + i.paidAmount, 0));
  const now = new Date();

  return (
    <>
      <TopBar
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "供应商", href: "/erp/suppliers" }, { label: supplier.name }]}
        actions={
          canEdit && (
            <>
              <ActionButton
                action={deleteSupplier.bind(null, supplier.id)}
                success="供应商已删除"
                redirectTo="/erp/suppliers"
                danger
                confirmText="删除"
                confirm={{ title: `删除「${supplier.name}」？`, description: "只有没有采购单和发票的供应商可以删除，删除后无法恢复。" }}
              >
                删除
              </ActionButton>
              <SupplierDialog supplier={supplier} trigger={<Button>编辑</Button>} />
              <LinkButton href={`/erp/purchase/new?supplierId=${supplier.id}`} variant="primary">
                <Plus className="size-3.5" />
                新建采购单
              </LinkButton>
            </>
          )
        }
      />
      <Page>
        <PageHeader
          icon="🏭"
          title={supplier.name}
          meta={
            <>
              <span className="font-mono text-xs text-ink-2">{supplier.code}</span>
              <RatingStars value={supplier.rating} />
            </>
          }
        />
        <Properties>
          <Property label="联系人">{supplier.contact ?? "—"}</Property>
          <Property label="电话">{supplier.phone ?? "—"}</Property>
          <Property label="邮箱">{supplier.email ?? "—"}</Property>
          <Property label="地址">{supplier.address ?? "—"}</Property>
          <Property label="备注">{supplier.remark ?? "—"}</Property>
          <Property label="创建时间">{formatDateTime(supplier.createdAt)}</Property>
        </Properties>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <StatCard label="累计采购额" value={formatMoney(totalPurchase)} hint={`${active.length} 张有效采购单`} />
          <StatCard label="已付款" value={formatMoney(paid)} />
          <StatCard label="应付未付" value={formatMoney(unpaid)} hint={`${openInvoices.length} 张未结清发票`} />
        </div>

        <Section title={`采购订单 · ${supplier.purchaseOrders.length}`}>
          <Table>
            <THead>
              <TR>
                <TH>单号</TH>
                <TH>入库仓库</TH>
                <TH className="text-right">金额</TH>
                <TH>状态</TH>
                <TH>预计到货</TH>
                <TH>创建人</TH>
                <TH>日期</TH>
              </TR>
            </THead>
            <TBody>
              {supplier.purchaseOrders.length === 0 && <TEmpty colSpan={7}>暂无采购单</TEmpty>}
              {supplier.purchaseOrders.map((po) => (
                <TR key={po.id}>
                  <TD>
                    <Link href={`/erp/purchase/${po.id}`} className="font-medium hover:underline">
                      {po.no}
                    </Link>
                  </TD>
                  <TD>{po.warehouse.name}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(po.totalAmount)}</TD>
                  <TD>
                    <StatusBadge map={PURCHASE_STATUS} value={po.status} />
                  </TD>
                  <TD className="text-ink-2">{formatDate(po.expectedDate)}</TD>
                  <TD>
                    <UserChip name={po.createdBy.name} color={po.createdBy.avatarColor} />
                  </TD>
                  <TD className="text-ink-2">{formatDate(po.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title={`应付发票 · ${supplier.invoices.length}`}>
          <Table>
            <THead>
              <TR>
                <TH>发票号</TH>
                <TH>采购单</TH>
                <TH className="text-right">金额</TH>
                <TH className="text-right">已付</TH>
                <TH className="text-right">未付</TH>
                <TH>到期日</TH>
                <TH>状态</TH>
              </TR>
            </THead>
            <TBody>
              {supplier.invoices.length === 0 && <TEmpty colSpan={7}>暂无应付发票</TEmpty>}
              {supplier.invoices.map((inv) => {
                const overdue = inv.dueDate && inv.dueDate < now && (inv.status === "UNPAID" || inv.status === "PARTIAL");
                return (
                  <TR key={inv.id}>
                    <TD>
                      <Link href={`/finance/invoices/${inv.id}`} className="font-medium hover:underline">
                        {inv.no}
                      </Link>
                    </TD>
                    <TD>
                      {inv.purchaseOrder ? (
                        <Link href={`/erp/purchase/${inv.purchaseOrder.id}`} className="text-accent hover:underline">
                          {inv.purchaseOrder.no}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(inv.amount)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatMoney(inv.paidAmount)}</TD>
                    <TD className="text-right tabular-nums">{inv.status === "VOID" ? "—" : formatMoney(inv.amount - inv.paidAmount)}</TD>
                    <TD className={overdue ? "font-medium text-danger" : "text-ink-2"}>
                      {formatDate(inv.dueDate)}
                      {overdue && " · 已逾期"}
                    </TD>
                    <TD>
                      <StatusBadge map={INVOICE_STATUS} value={inv.status} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>
      </Page>
    </>
  );
}
