import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { MOVEMENT_TYPE } from "@/lib/labels";
import { MOVEMENT_REF_LABEL, movementRefHref } from "@/lib/wms/constants";
import { cn } from "@/lib/utils";
import { MobileCard, MobileField, MobileList } from "@/components/mobile/mobile-list";

export type MovementRow = {
  id: string;
  createdAt: Date;
  type: keyof typeof MOVEMENT_TYPE;
  quantity: number;
  balance: number;
  refType: string | null;
  refId: string | null;
  refNo: string | null;
  memo: string | null;
  product: { id: string; sku: string; name: string; unit: string };
  warehouse: { id: string; name: string };
  user: { name: string; avatarColor: string } | null;
};

export const movementInclude = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
  warehouse: { select: { id: true, name: true } },
  user: { select: { name: true, avatarColor: true } },
} as const;

export function MovementTable({ rows, hideProduct, hideWarehouse }: { rows: MovementRow[]; hideProduct?: boolean; hideWarehouse?: boolean }) {
  const cols = 8 - (hideProduct ? 1 : 0) - (hideWarehouse ? 1 : 0);
  return (
    <>
    <MobileList empty="暂无库存流水">
      {rows.map((m) => {
        const href = movementRefHref(m.refType, m.refId);
        const ref = m.refNo ?? MOVEMENT_REF_LABEL[m.refType ?? ""];
        return (
          <MobileCard
            key={m.id}
            title={hideProduct ? (ref ?? formatDateTime(m.createdAt)) : m.product.name}
            badge={<StatusBadge map={MOVEMENT_TYPE} value={m.type} />}
            subtitle={[formatDateTime(m.createdAt), !hideProduct && m.product.sku, !hideWarehouse && m.warehouse.name].filter(Boolean).join(" · ")}
            meta={
              <>
                {!hideProduct && ref && (href ? (
                  <Link href={href} className="text-accent">
                    {ref}
                  </Link>
                ) : (
                  <span>{ref}</span>
                ))}
                <MobileField label="结存">{formatNumber(m.balance)}</MobileField>
                {m.user && <UserChip name={m.user.name} color={m.user.avatarColor} />}
                {m.memo && <span className="text-ink-3">{m.memo}</span>}
              </>
            }
            aside={
              <span className={m.quantity > 0 ? "text-[#448361]" : "text-danger"}>
                {m.quantity > 0 ? "+" : ""}
                {formatNumber(m.quantity)}
              </span>
            }
          />
        );
      })}
    </MobileList>
    <Table className="max-md:hidden">
      <THead>
        <TR>
          <TH>时间</TH>
          {!hideProduct && <TH>产品</TH>}
          {!hideWarehouse && <TH>仓库</TH>}
          <TH>类型</TH>
          <TH className="text-right">变动</TH>
          <TH className="text-right">结存</TH>
          <TH>关联单据</TH>
          <TH>操作人</TH>
          <TH>备注</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 && <TEmpty colSpan={cols + 1}>暂无库存流水</TEmpty>}
        {rows.map((m) => {
          const href = movementRefHref(m.refType, m.refId);
          return (
            <TR key={m.id}>
              <TD className="whitespace-nowrap text-ink-2 tabular-nums">{formatDateTime(m.createdAt)}</TD>
              {!hideProduct && (
                <TD className="min-w-40">
                  <Link href={`/wms/movements?product=${m.product.id}`} className="hover:underline">
                    {m.product.name}
                  </Link>
                  <div className="text-xs text-ink-3">{m.product.sku}</div>
                </TD>
              )}
              {!hideWarehouse && <TD className="whitespace-nowrap">{m.warehouse.name}</TD>}
              <TD>
                <StatusBadge map={MOVEMENT_TYPE} value={m.type} />
              </TD>
              <TD className={cn("text-right font-medium tabular-nums", m.quantity > 0 ? "text-[#448361]" : "text-danger")}>
                {m.quantity > 0 ? "+" : ""}
                {formatNumber(m.quantity)}
              </TD>
              <TD className="text-right tabular-nums">{formatNumber(m.balance)}</TD>
              <TD className="whitespace-nowrap">
                {href ? (
                  <Link href={href} className="text-accent hover:underline">
                    {m.refNo ?? MOVEMENT_REF_LABEL[m.refType ?? ""]}
                  </Link>
                ) : (
                  <span className="text-ink-2">{m.refNo ?? MOVEMENT_REF_LABEL[m.refType ?? ""] ?? "—"}</span>
                )}
              </TD>
              <TD>
                <UserChip name={m.user?.name} color={m.user?.avatarColor} />
              </TD>
              <TD className="max-w-56 truncate text-ink-2" title={m.memo ?? undefined}>
                {m.memo ?? "—"}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
    </>
  );
}
