import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getEnabledApps } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { moduleOfPermission } from "@/lib/apps";
import type { SearchHit } from "@/components/shell/command-palette";

const LIMIT = 6;

function snippet(text: string, q: string, len = 60) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, len);
  const start = Math.max(0, i - 20);
  return (start > 0 ? "…" : "") + text.slice(start, start + len).replace(/\s+/g, " ");
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ results: [] });
  const enabled = await getEnabledApps();
  const can = (p: Parameters<typeof hasPermission>[1]) => {
    const app = moduleOfPermission(p);
    return hasPermission(user.permissions, p) && (!app || enabled.has(app));
  };
  const tasks: Promise<SearchHit[]>[] = [];

  if (can("docs:view")) {
    tasks.push(
      db.document
        .findMany({
          where: {
            deletedAt: null,
            isTemplate: false,
            OR: [{ title: { contains: q } }, { text: { contains: q } }],
            space: { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: user.id } } }] },
          },
          select: { id: true, title: true, icon: true, text: true, space: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
          take: 8,
        })
        .then((rows) =>
          rows.map((d) => ({
            type: "doc",
            group: "文档",
            id: d.id,
            title: d.title || "无标题",
            subtitle: d.title.includes(q) ? d.space.name : snippet(d.text, q),
            href: `/docs/${d.id}`,
            icon: d.icon ?? "📄",
          })),
        ),
    );
  }
  if (can("oa:view")) {
    tasks.push(
      db.approvalInstance
        .findMany({
          where: {
            OR: [{ title: { contains: q } }, { no: { contains: q } }],
            AND: [{ OR: [{ applicantId: user.id }, { tasks: { some: { approverId: user.id } } }] }],
          },
          select: { id: true, title: true, no: true },
          take: LIMIT,
        })
        .then((rows) => rows.map((r) => ({ type: "approval", group: "审批", id: r.id, title: r.title, subtitle: r.no, href: `/oa/approvals/${r.id}`, icon: "📝" }))),
      db.announcement
        .findMany({ where: { title: { contains: q } }, select: { id: true, title: true }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "announcement", group: "公告", id: r.id, title: r.title, href: `/oa/announcements/${r.id}`, icon: "📢" }))),
    );
  }
  if (can("crm:view")) {
    tasks.push(
      db.customer
        .findMany({
          where: { OR: [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }] },
          select: { id: true, name: true, code: true, industry: true },
          take: LIMIT,
        })
        .then((rows) => rows.map((r) => ({ type: "customer", group: "客户", id: r.id, title: r.name, subtitle: [r.code, r.industry].filter(Boolean).join(" · "), href: `/crm/customers/${r.id}`, icon: "🏢" }))),
      db.opportunity
        .findMany({ where: { name: { contains: q } }, select: { id: true, name: true, customer: { select: { name: true } } }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "opportunity", group: "商机", id: r.id, title: r.name, subtitle: r.customer.name, href: `/crm/opportunities/${r.id}`, icon: "💡" }))),
    );
  }
  if (can("erp:view")) {
    tasks.push(
      db.product
        .findMany({ where: { OR: [{ name: { contains: q } }, { sku: { contains: q } }] }, select: { id: true, name: true, sku: true }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "product", group: "产品", id: r.id, title: r.name, subtitle: r.sku, href: `/erp/products/${r.id}`, icon: "📦" }))),
      db.purchaseOrder
        .findMany({ where: { OR: [{ no: { contains: q } }, { supplier: { name: { contains: q } } }] }, select: { id: true, no: true, supplier: { select: { name: true } } }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "po", group: "采购订单", id: r.id, title: r.no, subtitle: r.supplier.name, href: `/erp/purchase/${r.id}`, icon: "🛒" }))),
      db.salesOrder
        .findMany({ where: { OR: [{ no: { contains: q } }, { customer: { name: { contains: q } } }] }, select: { id: true, no: true, customer: { select: { name: true } } }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "so", group: "销售订单", id: r.id, title: r.no, subtitle: r.customer.name, href: `/erp/sales/${r.id}`, icon: "🧾" }))),
      db.supplier
        .findMany({ where: { OR: [{ name: { contains: q } }, { code: { contains: q } }] }, select: { id: true, name: true, code: true }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "supplier", group: "供应商", id: r.id, title: r.name, subtitle: r.code, href: `/erp/suppliers/${r.id}`, icon: "🏭" }))),
    );
  }
  if (can("wms:view")) {
    tasks.push(
      db.inboundOrder
        .findMany({ where: { no: { contains: q } }, select: { id: true, no: true }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "inbound", group: "入库单", id: r.id, title: r.no, href: `/wms/inbound/${r.id}`, icon: "📥" }))),
      db.outboundOrder
        .findMany({ where: { no: { contains: q } }, select: { id: true, no: true }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "outbound", group: "出库单", id: r.id, title: r.no, href: `/wms/outbound/${r.id}`, icon: "📤" }))),
    );
  }
  if (can("tms:view")) {
    tasks.push(
      db.transportOrder
        .findMany({
          where: { OR: [{ no: { contains: q } }, { destination: { contains: q } }, { consignee: { contains: q } }] },
          select: { id: true, no: true, destination: true },
          take: LIMIT,
        })
        .then((rows) => rows.map((r) => ({ type: "transport", group: "运输单", id: r.id, title: r.no, subtitle: r.destination, href: `/tms/orders/${r.id}`, icon: "🚚" }))),
    );
  }
  if (can("pms:view")) {
    tasks.push(
      db.project
        .findMany({ where: { OR: [{ name: { contains: q } }, { code: { contains: q } }] }, select: { id: true, name: true, code: true, icon: true }, take: LIMIT })
        .then((rows) => rows.map((r) => ({ type: "project", group: "项目", id: r.id, title: r.name, subtitle: r.code, href: `/pms/projects/${r.id}`, icon: r.icon }))),
      db.task
        .findMany({
          where: { title: { contains: q } },
          select: { id: true, title: true, no: true, projectId: true, project: { select: { code: true, name: true } } },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            type: "task",
            group: "任务",
            id: r.id,
            title: r.title,
            subtitle: `${r.project.code}-${r.no} · ${r.project.name}`,
            href: `/pms/projects/${r.projectId}?task=${r.id}`,
            icon: "✅",
          })),
        ),
    );
  }
  tasks.push(
    db.message
      .findMany({
        where: {
          recalledAt: null,
          type: { not: "SYSTEM" },
          text: { contains: q },
          conversation: { members: { some: { userId: user.id } } },
        },
        select: {
          id: true,
          conversationId: true,
          seq: true,
          threadRootId: true,
          text: true,
          sender: { select: { name: true } },
          conversation: {
            select: {
              type: true,
              name: true,
              members: { where: { userId: { not: user.id } }, take: 1, select: { user: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((m) => {
          const convName =
            m.conversation.type === "DIRECT"
              ? (m.conversation.members[0]?.user.name ?? "单聊")
              : (m.conversation.name ?? "群聊");
          return {
            type: "message",
            group: "聊天消息",
            id: m.id,
            title: snippet(m.text, q, 64),
            subtitle: [m.sender?.name, convName, m.threadRootId ? "话题回复" : null].filter(Boolean).join(" · "),
            href: m.threadRootId
              ? `/messages/${m.conversationId}?thread=${m.threadRootId}`
              : `/messages/${m.conversationId}?seq=${m.seq}`,
            icon: "💬",
          };
        }),
      ),
    db.user
      .findMany({ where: { active: true, OR: [{ name: { contains: q } }, { email: { contains: q } }] }, select: { id: true, name: true, email: true, title: true }, take: LIMIT })
      .then((rows) => rows.map((r) => ({ type: "user", group: "成员", id: r.id, title: r.name, subtitle: [r.title, r.email].filter(Boolean).join(" · "), href: `/settings/members?user=${r.id}`, icon: "👤" }))),
  );

  const results = (await Promise.all(tasks)).flat();
  return NextResponse.json({ results });
}
