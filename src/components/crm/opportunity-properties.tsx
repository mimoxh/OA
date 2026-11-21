"use client";

import Link from "next/link";
import { Building2, CalendarDays, CircleDot, Coins, Percent, UserRound } from "lucide-react";
import { Properties, Property } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { InlineDate, InlineSelect, InlineText } from "@/components/crm/inline";
import { OPPORTUNITY_STAGE } from "@/lib/labels";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import type { UserOption } from "@/lib/crm/types";
import { updateOpportunity } from "@/app/(app)/crm/actions";

export type OpportunityPropsValue = {
  id: string;
  amount: number;
  stage: keyof typeof OPPORTUNITY_STAGE;
  probability: number;
  expectedCloseDate: Date | null;
  ownerId: string | null;
  customer: { id: string; name: string };
};

export function OpportunityProperties({ opp, users, canEdit }: { opp: OpportunityPropsValue; users: UserOption[]; canEdit: boolean }) {
  const ro = !canEdit;
  return (
    <Properties>
      <Property label="客户" icon={<Building2 />}>
        <Link href={`/crm/customers/${opp.customer.id}`} className="hover:text-accent hover:underline">
          🏢 {opp.customer.name}
        </Link>
      </Property>
      <Property label="金额" icon={<Coins />}>
        <InlineText
          readOnly={ro}
          type="number"
          value={String(opp.amount)}
          display={<span className="font-medium tabular-nums">{formatMoney(opp.amount)}</span>}
          onSave={(v) => updateOpportunity(opp.id, { amount: v || 0 })}
        />
      </Property>
      <Property label="阶段" icon={<CircleDot />}>
        <StatusBadge map={OPPORTUNITY_STAGE} value={opp.stage} />
      </Property>
      <Property label="赢率" icon={<Percent />}>
        <InlineText
          readOnly={ro}
          type="number"
          value={String(opp.probability)}
          display={
            <span className="flex w-40 items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${opp.probability}%` }} />
              </span>
              <span className="tabular-nums">{opp.probability}%</span>
            </span>
          }
          onSave={(v) => updateOpportunity(opp.id, { probability: v || 0 })}
        />
      </Property>
      <Property label="预计成交" icon={<CalendarDays />}>
        <InlineDate
          readOnly={ro}
          value={toDateInput(opp.expectedCloseDate)}
          display={formatDate(opp.expectedCloseDate)}
          onSave={(v) => updateOpportunity(opp.id, { expectedCloseDate: v || null })}
        />
      </Property>
      <Property label="负责人" icon={<UserRound />}>
        <InlineSelect
          readOnly={ro}
          allowEmpty
          emptyLabel="取消分配"
          value={opp.ownerId}
          placeholder="未分配"
          options={users.map((u) => ({ value: u.id, label: <UserChip name={u.name} color={u.avatarColor} /> }))}
          onSave={(v) => updateOpportunity(opp.id, { ownerId: v || null })}
        />
      </Property>
    </Properties>
  );
}
