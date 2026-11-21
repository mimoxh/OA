import Link from "next/link";
import { CalendarClock, Truck, UserRound, Weight } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";
import { TRANSPORT_STATUS } from "@/lib/labels";
import { StatusBadge } from "@/components/ui/badge";
import type { ReactNode } from "react";

export type BoardOrder = {
  id: string;
  no: string;
  status: keyof typeof TRANSPORT_STATUS;
  origin: string;
  destination: string;
  weight: number;
  plannedAt: Date | null;
  deliveredAt: Date | null;
  departedAt: Date | null;
  customer: { name: string } | null;
  consignee: string | null;
  vehicle: { plateNo: string } | null;
  driver: { name: string } | null;
};

export function TransportCard({ order, action, showStatus }: { order: BoardOrder; action?: ReactNode; showStatus?: boolean }) {
  const time =
    order.status === "DELIVERED"
      ? { label: "签收", at: order.deliveredAt }
      : order.status === "IN_TRANSIT"
        ? { label: "发车", at: order.departedAt }
        : { label: "计划", at: order.plannedAt };
  return (
    <div className="group rounded-lg border border-line bg-white p-3 shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/tms/orders/${order.id}`} className="text-[13px] font-semibold tabular-nums text-ink hover:text-accent hover:underline">
          {order.no}
        </Link>
        {showStatus && <StatusBadge map={TRANSPORT_STATUS} value={order.status} />}
      </div>
      <Link href={`/tms/orders/${order.id}`} className="mt-1.5 block text-[13px] leading-snug text-ink">
        <span className="line-clamp-1">{order.origin}</span>
        <span className="line-clamp-2 text-ink-2">→ {order.destination}</span>
      </Link>
      {(order.customer || order.consignee) && (
        <div className="mt-1.5 truncate text-xs text-ink-2">🏢 {order.customer?.name ?? order.consignee}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1">
          <Weight className="size-3 text-ink-3" />
          {formatNumber(order.weight, 1)} kg
        </span>
        {order.vehicle && (
          <span className="inline-flex items-center gap-1">
            <Truck className="size-3 text-ink-3" />
            {order.vehicle.plateNo}
          </span>
        )}
        {order.driver && (
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3 text-ink-3" />
            {order.driver.name}
          </span>
        )}
      </div>
      {(time.at || action) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
          <span className="inline-flex items-center gap-1 text-xs text-ink-3">
            {time.at && (
              <>
                <CalendarClock className="size-3" />
                {time.label} {formatDateTime(time.at)}
              </>
            )}
          </span>
          {action}
        </div>
      )}
    </div>
  );
}

export const boardOrderSelect = {
  id: true,
  no: true,
  status: true,
  origin: true,
  destination: true,
  weight: true,
  plannedAt: true,
  deliveredAt: true,
  departedAt: true,
  consignee: true,
  customer: { select: { name: true } },
  vehicle: { select: { plateNo: true } },
  driver: { select: { name: true } },
} as const;
