import Link from "next/link";
import { endOfDay, format, isBefore, startOfDay, startOfMonth } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ArrowRight, BookOpen, FileText, Inbox, Megaphone, Pin, Stamp } from "lucide-react";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { can, getEnabledApps, requireUser } from "@/lib/auth/dal";
import { NAV_MODULES } from "@/lib/nav";
import { MODULES, type ModuleKey } from "@/lib/permissions";
import { TASK_PRIORITY } from "@/lib/labels";
import { formatMoney, formatRelative } from "@/lib/format";
import { approvalTabWhere } from "@/lib/oa/server";
import { CATEGORY_COLOR } from "@/lib/oa/types";
import { Page, TopBar } from "@/components/ui/page";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RailPinButton } from "./rail-pin-button";
import { WebFullLink } from "./web-full-link";

function greeting(h: number) {
  if (h < 6) return { text: "夜深了", icon: "🌙" };
  if (h < 11) return { text: "早上好", icon: "☀️" };
  if (h < 13) return { text: "中午好", icon: "🌤️" };
  if (h < 18) return { text: "下午好", icon: "⛅" };
  return { text: "晚上好", icon: "🌙" };
}

function Block({ title, href, count, children }: { title: string; href?: string; count?: number; children: ReactNode }) {
  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {title}
          {count !== undefined && count > 0 && <span className="rounded bg-[#eb5757] px-1.5 text-[11px] font-medium leading-4 text-white">{count}</span>}
        </span>
        {href && (
          <Link href={href} className="flex items-center gap-0.5 text-xs text-ink-3 hover:text-ink">
            全部
            <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="flex-1 px-1.5 pb-2">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[140px] items-center justify-center text-[13px] text-ink-3">{children}</div>;
}

function MobileEntry({ href, icon, color, label, hint, badge }: {
  href: string;
  icon: ReactNode;
  color: string;
  label: string;
  hint: string;
  badge?: number;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 active:bg-sidebar">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1f`, color }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block truncate text-xs text-ink-3">{hint}</span>
      </span>
      {!!badge && badge > 0 && (
        <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-white">{badge > 99 ? "99+" : badge}</span>
      )}
      <ArrowRight className="size-4 text-ink-3" />
    </Link>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-10 text-center text-xs font-medium text-ink-3">{children}</h2>;
}

/** 等宽换行网格：不满一行时居中（CSS grid 做不到最后一行居中） */
const CENTER_ROW = "flex flex-wrap justify-center gap-3 *:min-w-0 *:shrink-0 *:grow-0";
const COLS_2_4 = "*:basis-[calc((100%_-_12px)/2)] sm:*:basis-[calc((100%_-_36px)/4)]";

function AppTile({
  href,
  color,
  icon,
  label,
  description,
  pin,
}: {
  href: string;
  color: string;
  icon: ReactNode;
  label: string;
  description: string;
  pin?: { appKey: string; pinned: boolean };
}) {
  return (
    <div className="group/tile relative">
      <Link href={href} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 transition-colors hover:bg-sidebar">
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1f`, color }}>
          {icon}
          {pin?.pinned && (
            <span title="已添加到侧边栏" className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-white text-accent shadow-sm ring-1 ring-line">
              <Pin className="size-2.5 fill-current" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{label}</span>
          <span className="block truncate text-xs text-ink-3">{description}</span>
        </span>
      </Link>
      {pin && <RailPinButton appKey={pin.appKey} label={label} pinned={pin.pinned} />}
    </div>
  );
}

export default async function WorkPage() {
  const user = await requireUser();
  const enabled = await getEnabledApps();
  const now = new Date();
  const g = greeting(now.getHours());
  const perm = {
    docs: enabled.has("docs") && can(user, "docs:view"),
    oa: enabled.has("oa") && can(user, "oa:view"),
    crm: enabled.has("crm") && can(user, "crm:view"),
    erp: enabled.has("erp") && can(user, "erp:view"),
    finance: enabled.has("finance") && can(user, "finance:view"),
    wms: enabled.has("wms") && can(user, "wms:view"),
    tms: enabled.has("tms") && can(user, "tms:view"),
    pms: enabled.has("pms") && can(user, "pms:view"),
  };
  const visibleSpace = { OR: [{ visibility: "PUBLIC" as const }, { members: { some: { userId: user.id } } }] };
  const none = <T,>(v: T) => Promise.resolve(v);

  const [approvals, approvalCount, tasks, taskCount, events, docs, announcements, inboxUnread, unreadAnnouncements] = await Promise.all([
    perm.oa
      ? db.approvalInstance.findMany({
          where: approvalTabWhere("todo", user.id),
          include: { flow: { select: { icon: true, name: true } }, applicant: { select: { name: true, avatarColor: true } } },
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : none([]),
    perm.oa ? db.approvalInstance.count({ where: approvalTabWhere("todo", user.id) }) : none(0),
    perm.pms
      ? db.task.findMany({
          where: { assigneeId: user.id, status: { not: "DONE" } },
          include: { project: { select: { name: true, icon: true } } },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
          take: 5,
        })
      : none([]),
    perm.pms ? db.task.count({ where: { assigneeId: user.id, status: { not: "DONE" } } }) : none(0),
    perm.oa
      ? db.calendarEvent.findMany({
          where: {
            AND: [
              { OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }] },
              { startAt: { lte: endOfDay(now) } },
              { endAt: { gte: startOfDay(now) } },
            ],
          },
          orderBy: { startAt: "asc" },
          take: 6,
        })
      : none([]),
    perm.docs
      ? db.document.findMany({
          where: { deletedAt: null, isTemplate: false, kind: { not: "row" }, space: visibleSpace },
          select: {
            id: true,
            title: true,
            icon: true,
            text: true,
            updatedAt: true,
            space: { select: { name: true, icon: true } },
            updatedBy: { select: { name: true, avatarColor: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        })
      : none([]),
    perm.oa
      ? db.announcement.findMany({
          orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
          include: { author: { select: { name: true, avatarColor: true } }, reads: { where: { userId: user.id }, select: { id: true } } },
          take: 4,
        })
      : none([]),
    db.notification.count({ where: { userId: user.id, read: false } }),
    perm.oa ? db.announcement.count({ where: { reads: { none: { userId: user.id } } } }) : none(0),
  ]);

  const monthStart = startOfMonth(now);
  const [newCustomers, pendingSales, pendingPurchase, receivables, lowStock, inTransit, activeProjects, docCount] = await Promise.all([
    perm.crm ? db.customer.count({ where: { createdAt: { gte: monthStart } } }) : none(0),
    perm.erp ? db.salesOrder.count({ where: { status: { in: ["DRAFT", "CONFIRMED"] } } }) : none(0),
    perm.erp ? db.purchaseOrder.count({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PARTIAL_RECEIVED"] } } }) : none(0),
    perm.finance
      ? db.invoice.findMany({ where: { type: "RECEIVABLE", status: { in: ["UNPAID", "PARTIAL"] } }, select: { amount: true, paidAmount: true } })
      : none([] as { amount: number; paidAmount: number }[]),
    perm.wms
      ? (async () => {
          const [products, sums] = await Promise.all([
            db.product.findMany({ where: { active: true, safetyStock: { gt: 0 } }, select: { id: true, safetyStock: true } }),
            db.inventory.groupBy({ by: ["productId"], _sum: { quantity: true } }),
          ]);
          const qty = new Map(sums.map((s) => [s.productId, s._sum.quantity ?? 0]));
          return products.filter((p) => (qty.get(p.id) ?? 0) < p.safetyStock).length;
        })()
      : none(0),
    perm.tms ? db.transportOrder.count({ where: { status: "IN_TRANSIT" } }) : none(0),
    perm.pms ? db.project.count({ where: { status: "ACTIVE" } }) : none(0),
    perm.docs ? db.document.count({ where: { deletedAt: null, isTemplate: false, kind: { not: "row" }, space: visibleSpace } }) : none(0),
  ]);
  const receivable = receivables.reduce((s, i) => s + i.amount - i.paidAmount, 0);

  const metrics: Record<string, { value: ReactNode; hint: string; href?: string }> = {
    oa: { value: approvalCount, hint: "待我审批", href: "/oa/approvals" },
    crm: { value: newCustomers, hint: "本月新增客户", href: "/crm/customers" },
    erp: { value: pendingSales + pendingPurchase, hint: `待处理订单（销售 ${pendingSales} · 采购 ${pendingPurchase}）`, href: "/erp" },
    finance: { value: formatMoney(receivable), hint: "未结清应收", href: "/finance/invoices" },
    wms: { value: lowStock, hint: "低于安全库存的产品", href: "/wms/inventory" },
    tms: { value: inTransit, hint: "运输中", href: "/tms/orders" },
    pms: { value: activeProjects, hint: "进行中的项目", href: "/pms" },
  };
  const modules = NAV_MODULES.filter((m) => enabled.has(m.key as ModuleKey) && can(user, m.perm));
  const todoTotal = approvalCount + taskCount;
  const today = startOfDay(now);

  return (
    <>
      <TopBar crumbs={[{ label: "工作台" }]} />
      <Page>
        <header className="pt-14 pb-2 text-center max-md:pt-6">
          <div className="mb-3 text-[44px] leading-none max-md:text-[36px]">{g.icon}</div>
          <h1 className="text-[30px] font-bold tracking-tight text-ink max-md:text-2xl">
            {g.text}，{user.name}
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-2">
            {format(now, "M月d日 EEEE", { locale: zhCN })}
            {user.departmentName ? ` · ${user.departmentName}` : ""}
            {todoTotal > 0 ? ` · 你有 ${todoTotal} 项待办` : " · 今天没有待办事项"}
          </p>
        </header>

        {/* 手机布局没有侧边栏，收件箱入口放在工作台顶部 */}
        <Link
          href="/inbox"
          className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-white p-3 active:bg-sidebar md:hidden"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Inbox className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">收件箱</span>
            <span className="block truncate text-xs text-ink-3">审批、评论、@提及、任务等通知</span>
          </span>
          {inboxUnread > 0 && (
            <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-white">{inboxUnread > 99 ? "99+" : inboxUnread}</span>
          )}
          <ArrowRight className="size-4 text-ink-3" />
        </Link>

        {/* 手机端第一期的工作入口：审批（只处理）、公告（只读）与 Web 完整版 */}
        <div className="mt-2 space-y-2 md:hidden" data-mobile-work-entries>
          {perm.oa && (
            <>
              <MobileEntry
                href="/oa/approvals"
                icon={<Stamp className="size-5" />}
                color="#448361"
                label="审批"
                hint={approvalCount > 0 ? `${approvalCount} 项待我审批` : "查看并处理审批"}
                badge={approvalCount}
              />
              <MobileEntry
                href="/oa/announcements"
                icon={<Megaphone className="size-5" />}
                color="#d9730d"
                label="公告"
                hint={unreadAnnouncements > 0 ? `${unreadAnnouncements} 条未读公告` : "公司动态、制度与通知"}
                badge={unreadAnnouncements}
              />
            </>
          )}
          <WebFullLink />
        </div>

        <SectionTitle>应用</SectionTitle>
        <div
          className={cn(
            CENTER_ROW,
            "*:basis-[calc((100%_-_12px)/2)] sm:*:basis-[calc((100%_-_24px)/3)] lg:*:basis-[calc((100%_-_36px)/4)] xl:*:basis-[calc((100%_-_60px)/6)]",
          )}
        >
          {perm.docs && (
            <AppTile href="/docs" color="#2383e2" icon={<FileText className="size-5" />} label="云文档" description={MODULES.find((m) => m.key === "docs")!.description} />
          )}
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <AppTile
                key={m.key}
                href={m.href}
                color={m.color}
                icon={<Icon className="size-5" />}
                label={m.label}
                description={MODULES.find((x) => x.key === m.key)?.description ?? ""}
                pin={{ appKey: m.key, pinned: user.railPins.includes(m.key) }}
              />
            );
          })}
        </div>

        <SectionTitle>待办</SectionTitle>
        <div className={cn(CENTER_ROW, "*:basis-full md:*:basis-[calc((100%_-_24px)/3)]")}>
          {perm.oa && (
            <Block title="待我审批" href="/oa/approvals" count={approvalCount}>
              {approvals.length === 0 ? (
                <Empty>🎉 没有待审批事项</Empty>
              ) : (
                approvals.map((a) => (
                  <Link key={a.id} href={`/oa/approvals/${a.id}`} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover">
                    <span className="text-base">{a.flow.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{a.title}</span>
                      <span className="flex items-center gap-1 text-[11px] text-ink-3">
                        <Avatar name={a.applicant.name} color={a.applicant.avatarColor} size={12} />
                        {a.applicant.name} · {formatRelative(a.createdAt)}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </Block>
          )}
          {perm.pms && (
            <Block title="我的任务" href="/pms/my-tasks" count={taskCount}>
              {tasks.length === 0 ? (
                <Empty>没有未完成的任务</Empty>
              ) : (
                tasks.map((t) => {
                  const overdue = t.dueDate && isBefore(t.dueDate, today);
                  return (
                    <Link
                      key={t.id}
                      href={`/pms/projects/${t.projectId}?task=${t.id}`}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover"
                    >
                      <span className="text-base">{t.project.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{t.title}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                          <span className="truncate">{t.project.name}</span>
                          {t.dueDate && <span className={cn(overdue && "text-danger")}>{overdue ? "已逾期 · " : ""}{format(t.dueDate, "M月d日")}截止</span>}
                        </span>
                      </span>
                      <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                    </Link>
                  );
                })
              )}
            </Block>
          )}
          {perm.oa && (
            <Block title="今日日程" href="/oa/calendar?view=week">
              {events.length === 0 ? (
                <Empty>今天没有日程安排</Empty>
              ) : (
                events.map((e) => (
                  <Link
                    key={e.id}
                    href={`/oa/calendar?date=${format(e.startAt, "yyyy-MM-dd")}&event=${e.id}`}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover"
                  >
                    <span className="h-7 w-1 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{e.title}</span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {e.allDay ? "全天" : `${format(e.startAt, "HH:mm")} - ${format(e.endAt, "HH:mm")}`}
                        {e.location ? ` · ${e.location}` : ""}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </Block>
          )}
        </div>

        {perm.docs && (
          <>
            <SectionTitle>最近编辑的文档</SectionTitle>
            {docs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-strong py-8 text-center text-[13px] text-ink-3">还没有文档</div>
            ) : (
              <div className={cn(CENTER_ROW, COLS_2_4)}>
                {docs.map((d) => (
                  <Link key={d.id} href={`/docs/${d.id}`} className="group overflow-hidden rounded-xl border border-line bg-white transition-shadow hover:shadow-pop">
                    <div className="relative h-12 bg-sidebar">
                      <span className="absolute -bottom-3.5 left-3 text-[28px] leading-none">{d.icon ?? "📄"}</span>
                    </div>
                    <div className="px-3 pt-5 pb-3">
                      <div className="truncate text-sm font-medium text-ink">{d.title || "无标题"}</div>
                      <div className="mt-0.5 line-clamp-1 h-4 text-[11px] text-ink-3">{d.text.slice(0, 60)}</div>
                      <div className="mt-2 flex items-center gap-1 text-[11px] text-ink-3">
                        {d.updatedBy && <Avatar name={d.updatedBy.name} color={d.updatedBy.avatarColor} size={14} />}
                        <span className="truncate">
                          {d.space.icon} {d.space.name} · {formatRelative(d.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        <SectionTitle>应用概览</SectionTitle>
        <div className={cn(CENTER_ROW, COLS_2_4)}>
          {perm.docs && (
            <Link href="/docs" className="rounded-xl border border-line bg-white p-4 transition-colors hover:bg-sidebar">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <BookOpen className="size-[18px] text-[#787774]" />
                文档
              </div>
              <div className="mt-3 text-2xl font-semibold tabular-nums text-ink">{docCount}</div>
              <div className="mt-0.5 text-xs text-ink-3">我可见的文档</div>
            </Link>
          )}
          {modules.map((m) => {
            const Icon = m.icon;
            const metric = metrics[m.key];
            return (
              <Link key={m.key} href={metric?.href && can(user, m.perm) ? m.href : m.href} className="rounded-xl border border-line bg-white p-4 transition-colors hover:bg-sidebar">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Icon className="size-[18px]" style={{ color: m.color }} />
                  {m.label}
                </div>
                <div className="mt-3 truncate text-2xl font-semibold tabular-nums text-ink">{metric?.value ?? "—"}</div>
                <div className="mt-0.5 truncate text-xs text-ink-3">{metric?.hint ?? m.items.map((i) => i.label).slice(1, 3).join(" · ")}</div>
              </Link>
            );
          })}
        </div>

        {perm.oa && announcements.length > 0 && (
          <>
            <SectionTitle>最新公告</SectionTitle>
            <div className="divide-y divide-line rounded-xl border border-line bg-white">
              {announcements.map((a) => (
                <Link key={a.id} href={`/oa/announcements/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sidebar">
                  <span className="flex w-2 justify-center">{!a.reads.length && <span className="size-2 rounded-full bg-accent" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("flex items-center gap-2 text-sm", a.reads.length ? "text-ink" : "font-semibold text-ink")}>
                      {a.pinned && <span title="置顶">📌</span>}
                      <span className="truncate">{a.title}</span>
                    </span>
                  </span>
                  <Badge color={CATEGORY_COLOR[a.category] ?? "gray"}>{a.category}</Badge>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3">
                    <Avatar name={a.author.name} color={a.author.avatarColor} size={14} />
                    {a.author.name} · {formatRelative(a.publishedAt)}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </Page>
    </>
  );
}
