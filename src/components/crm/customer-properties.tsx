"use client";

import { Building2, CalendarClock, CircleDot, Flag, Mail, MapPin, Phone, Radio, StickyNote, UserRound } from "lucide-react";
import { Properties, Property } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { InlineSelect, InlineText } from "@/components/crm/inline";
import { CUSTOMER_LEVEL, CUSTOMER_STATUS } from "@/lib/labels";
import { CUSTOMER_SOURCES, type UserOption } from "@/lib/crm/types";
import { formatDateTime } from "@/lib/format";
import { updateCustomer, type CustomerInput } from "@/app/(app)/crm/actions";

export type CustomerPropsValue = {
  id: string;
  status: keyof typeof CUSTOMER_STATUS;
  level: string;
  industry: string | null;
  source: string | null;
  ownerId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  remark: string | null;
  createdAt: Date;
};

export function CustomerProperties({ customer: c, users, canEdit }: { customer: CustomerPropsValue; users: UserOption[]; canEdit: boolean }) {
  const save = (patch: Partial<CustomerInput>) => updateCustomer(c.id, patch);
  const ro = !canEdit;
  return (
    <Properties>
      <Property label="状态" icon={<CircleDot />}>
        <InlineSelect
          readOnly={ro}
          value={c.status}
          options={Object.keys(CUSTOMER_STATUS).map((k) => ({ value: k, label: <StatusBadge map={CUSTOMER_STATUS} value={k as keyof typeof CUSTOMER_STATUS} /> }))}
          onSave={(v) => save({ status: v as CustomerInput["status"] })}
        />
      </Property>
      <Property label="等级" icon={<Flag />}>
        <InlineSelect
          readOnly={ro}
          value={c.level}
          options={Object.keys(CUSTOMER_LEVEL).map((k) => ({ value: k, label: <StatusBadge map={CUSTOMER_LEVEL} value={k as keyof typeof CUSTOMER_LEVEL} /> }))}
          onSave={(v) => save({ level: v as CustomerInput["level"] })}
        />
      </Property>
      <Property label="行业" icon={<Building2 />}>
        <InlineText readOnly={ro} value={c.industry} onSave={(v) => save({ industry: v })} />
      </Property>
      <Property label="来源" icon={<Radio />}>
        <InlineSelect
          readOnly={ro}
          allowEmpty
          value={c.source}
          options={[...new Set([...CUSTOMER_SOURCES, ...(c.source ? [c.source] : [])])].map((s) => ({ value: s, label: <span>{s}</span> }))}
          onSave={(v) => save({ source: v })}
        />
      </Property>
      <Property label="负责人" icon={<UserRound />}>
        <InlineSelect
          readOnly={ro}
          allowEmpty
          emptyLabel="取消分配"
          value={c.ownerId}
          options={users.map((u) => ({ value: u.id, label: <UserChip name={u.name} color={u.avatarColor} /> }))}
          onSave={(v) => save({ ownerId: v })}
        />
      </Property>
      <Property label="电话" icon={<Phone />}>
        <InlineText readOnly={ro} type="tel" value={c.phone} onSave={(v) => save({ phone: v })} />
      </Property>
      <Property label="邮箱" icon={<Mail />}>
        <InlineText readOnly={ro} type="email" value={c.email} onSave={(v) => save({ email: v })} />
      </Property>
      <Property label="地址" icon={<MapPin />}>
        <InlineText readOnly={ro} value={c.address} onSave={(v) => save({ address: v })} />
      </Property>
      <Property label="备注" icon={<StickyNote />}>
        <InlineText readOnly={ro} multiline value={c.remark} onSave={(v) => save({ remark: v })} />
      </Property>
      <Property label="创建时间" icon={<CalendarClock />}>
        <span className="text-ink-2">{formatDateTime(c.createdAt)}</span>
      </Property>
    </Properties>
  );
}
