import { db, type DbClient } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { hasPermission, type Permission } from "@/lib/permissions";
import { getDocAccess } from "@/lib/docs/access";
import {
  APPROVAL_STATUS,
  CUSTOMER_STATUS,
  OPPORTUNITY_STAGE,
  PROJECT_STATUS,
  PURCHASE_STATUS,
  SALES_STATUS,
  TRANSPORT_STATUS,
  type StatusMeta,
} from "@/lib/labels";
import type { Card, RefPreview, RefType } from "./types";

const MAX_REFS = 20;

type UserLike = { id: string; permissions: string[] };

// 审批可见性规则的轻量复刻（canViewApproval 依赖 oa/server.ts 的 server-only 边界）
function canSeeApproval(user: UserLike, inst: { applicantId: string; formData: string; tasks: { approverId: string }[]; flow: { formSchema: string } }) {
  if (hasPermission(user.permissions, "oa:edit")) return true;
  if (inst.applicantId === user.id) return true;
  if (inst.tasks.some((t) => t.approverId === user.id)) return true;
  try {
    const data = JSON.parse(inst.formData) as Record<string, unknown>;
    const fields = JSON.parse(inst.flow.formSchema) as { type?: string; name?: string }[];
    return fields.some((f) => f.type === "user" && typeof f.name === "string" && data[f.name] === user.id);
  } catch {
    return false;
  }
}

function cardColor(color: StatusMeta["color"]): NonNullable<Card["status"]>["color"] {
  switch (color) {
    case "green":
    case "red":
    case "blue":
      return color;
    case "yellow":
    case "orange":
      return "orange";
    default:
      return "gray";
  }
}

const statusOf = (map: Record<string, StatusMeta>, value: string): Card["status"] =>
  map[value] ? { label: map[value].label, color: cardColor(map[value].color) } : { label: value, color: "gray" };

const forbidden = (type: RefType, id: string): RefPreview => ({ type, id, ok: false, reason: "forbidden" });
const notFound = (type: RefType, id: string): RefPreview => ({ type, id, ok: false, reason: "not_found" });

export async function resolveRefs(user: UserLike, refs: { type: RefType; id: string }[], client: DbClient = db): Promise<RefPreview[]> {
  const out: RefPreview[] = [];
  for (const ref of refs.slice(0, MAX_REFS)) {
    out.push(await resolveOne(user, ref, client));
  }
  return out;
}

async function resolveOne(user: UserLike, ref: { type: RefType; id: string }, client: DbClient): Promise<RefPreview> {
  const perm = (p: Permission) => hasPermission(user.permissions, p);
  try {
    switch (ref.type) {
      case "document": {
        const res = await getDocAccess(user, ref.id, client);
        if (!res || res.doc.deletedAt) return notFound(ref.type, ref.id);
        if (!res.canRead) return forbidden(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: res.doc.title || "无标题",
          subtitle: res.doc.space?.name ?? null,
          icon: res.doc.icon ?? null,
          href: `/docs/${res.doc.id}`,
        };
      }
      case "approval": {
        if (!perm("oa:view")) return forbidden(ref.type, ref.id);
        const inst = await client.approvalInstance.findUnique({
          where: { id: ref.id },
          include: { flow: { select: { name: true, formSchema: true } }, tasks: { select: { approverId: true } } },
        });
        if (!inst) return notFound(ref.type, ref.id);
        if (!canSeeApproval(user, inst)) return forbidden(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: inst.title,
          subtitle: `${inst.flow.name} · ${inst.no}`,
          href: `/oa/approvals/${inst.id}`,
          status: statusOf(APPROVAL_STATUS, inst.status),
        };
      }
      case "customer": {
        if (!perm("crm:view")) return forbidden(ref.type, ref.id);
        const c = await client.customer.findUnique({ where: { id: ref.id }, include: { owner: { select: { name: true } } } });
        if (!c) return notFound(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: c.name,
          subtitle: c.industry ?? null,
          href: `/crm/customers/${c.id}`,
          status: statusOf(CUSTOMER_STATUS, c.status),
          fields: [
            { label: "编码", value: c.code },
            ...(c.owner ? [{ label: "负责人", value: c.owner.name }] : []),
          ],
        };
      }
      case "opportunity": {
        if (!perm("crm:view")) return forbidden(ref.type, ref.id);
        const o = await client.opportunity.findUnique({
          where: { id: ref.id },
          include: { customer: { select: { name: true } }, owner: { select: { name: true } } },
        });
        if (!o) return notFound(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: o.name,
          subtitle: `${o.customer.name} · ${formatMoney(o.amount)}`,
          href: `/crm/opportunities/${o.id}`,
          status: statusOf(OPPORTUNITY_STAGE, o.stage),
          fields: o.owner ? [{ label: "负责人", value: o.owner.name }] : [],
        };
      }
      case "sales": {
        if (!perm("erp:view")) return forbidden(ref.type, ref.id);
        const s = await client.salesOrder.findUnique({ where: { id: ref.id }, include: { customer: { select: { name: true } } } });
        if (!s) return notFound(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: s.no,
          subtitle: s.customer.name,
          href: `/erp/sales/${s.id}`,
          status: statusOf(SALES_STATUS, s.status),
          fields: [{ label: "金额", value: formatMoney(s.totalAmount) }],
        };
      }
      case "purchase": {
        if (!perm("erp:view")) return forbidden(ref.type, ref.id);
        const p = await client.purchaseOrder.findUnique({ where: { id: ref.id }, include: { supplier: { select: { name: true } } } });
        if (!p) return notFound(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: p.no,
          subtitle: p.supplier.name,
          href: `/erp/purchase/${p.id}`,
          status: statusOf(PURCHASE_STATUS, p.status),
          fields: [{ label: "金额", value: formatMoney(p.totalAmount) }],
        };
      }
      case "project": {
        if (!perm("pms:view")) return forbidden(ref.type, ref.id);
        const p = await client.project.findUnique({ where: { id: ref.id }, include: { owner: { select: { name: true } } } });
        if (!p) return notFound(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: p.name,
          subtitle: p.code,
          icon: p.icon,
          href: `/pms/projects/${p.id}`,
          status: statusOf(PROJECT_STATUS, p.status),
          fields: [{ label: "负责人", value: p.owner.name }],
        };
      }
      case "transport": {
        if (!perm("tms:view")) return forbidden(ref.type, ref.id);
        const t = await client.transportOrder.findUnique({ where: { id: ref.id } });
        if (!t) return notFound(ref.type, ref.id);
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: t.no,
          subtitle: `${t.origin} → ${t.destination}`,
          href: `/tms/orders/${t.id}`,
          status: statusOf(TRANSPORT_STATUS, t.status),
        };
      }
      case "event": {
        if (!perm("oa:view")) return forbidden(ref.type, ref.id);
        const ev = await client.calendarEvent.findUnique({
          where: { id: ref.id },
          include: {
            organizer: { select: { name: true } },
            attendees: { select: { userId: true } },
          },
        });
        if (!ev) return notFound(ref.type, ref.id);
        const canSee =
          ev.organizerId === user.id ||
          ev.attendees.some((a) => a.userId === user.id) ||
          perm("admin");
        if (!canSee) return forbidden(ref.type, ref.id);
        const pad = (n: number) => String(n).padStart(2, "0");
        const dateStr = `${ev.startAt.getFullYear()}-${pad(ev.startAt.getMonth() + 1)}-${pad(ev.startAt.getDate())}`;
        return {
          type: ref.type,
          id: ref.id,
          ok: true,
          title: ev.title,
          subtitle: ev.location ?? `组织者：${ev.organizer.name}`,
          icon: "📅",
          href: `/oa/calendar?date=${dateStr}&event=${ev.id}`,
          status: { label: "日程", color: "blue" },
        };
      }
      default:
        return notFound(ref.type, ref.id);
    }
  } catch (e) {
    console.error("[im] 解析引用失败", ref, e);
    return notFound(ref.type, ref.id);
  }
}
