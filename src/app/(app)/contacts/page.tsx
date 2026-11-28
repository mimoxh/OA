import Link from "next/link";
import { Bot, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { flattenDepartments } from "@/components/settings/dept-utils";
import { ContextPanel } from "@/components/shell/context-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/common";
import { EmptyState, Page, TopBar } from "@/components/ui/page";
import { contactsDeptScope } from "@/lib/contacts";
import { groupByPinyin, INDEX_LETTERS, letterAnchorId } from "@/lib/pinyin";
import { cn } from "@/lib/utils";
import { LetterIndex } from "./letter-index";
import { MemberCard } from "./member-card";

export const metadata = { title: "通讯录" };

function DeptLink({ href, label, count, depth = 0, active }: { href: string; label: string; count: number; depth?: number; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-active/70",
        active && "bg-active/80 font-medium text-ink",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-ink-3">{count}</span>
    </Link>
  );
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  await requireUser();
  const sp = await searchParams;
  const deptId = typeof sp.dept === "string" ? sp.dept : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const BOTS_KEY = "bots";
  const showBotsOnly = deptId === BOTS_KEY;
  const [depts, counts, botCount] = await Promise.all([
    db.department.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.user.groupBy({ by: ["departmentId"], where: { active: true, isBot: false }, _count: { _all: true } }),
    db.user.count({ where: { active: true, isBot: true, webhookConnector: { is: { enabled: true } } } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.departmentId, c._count._all]));
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const flat = flattenDepartments(depts);

  const scope = contactsDeptScope(depts, deptId);
  const deptIds = scope?.memberDeptIds ?? null;

  const search = q
    ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { title: { contains: q } }, { phone: { contains: q } }] }
    : {};
  const [users, bots] = await Promise.all([
    showBotsOnly
      ? Promise.resolve([])
      : db.user.findMany({
          where: { active: true, isBot: false, ...(deptIds ? { departmentId: { in: deptIds } } : {}), ...search },
          include: { department: { select: { name: true } }, role: { select: { name: true } } },
          orderBy: { name: "asc" },
        }),
    // 机器人无部门：在「全部成员」与「Webhook 机器人」分组下展示
    deptIds
      ? Promise.resolve([])
      : db.user.findMany({
          where: {
            active: true,
            isBot: true,
            webhookConnector: { is: { enabled: true } },
            ...(q ? { OR: [{ name: { contains: q } }, { title: { contains: q } }] } : {}),
          },
          include: { webhookConnector: { select: { description: true } } },
          orderBy: { name: "asc" },
        }),
  ]);

  const hrefFor = (dept: string | null) => {
    const p = new URLSearchParams();
    if (dept) p.set("dept", dept);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/contacts?${s}` : "/contacts";
  };

  const groups = groupByPinyin(users, (u) => u.name);
  const subDepts = scope ? flat.filter((d) => scope.children.some((c) => c.id === d.id)) : [];

  const selectedName = showBotsOnly ? "Webhook 机器人" : deptId ? flat.find((d) => d.id === deptId)?.name ?? "部门" : "全部成员";

  return (
    <div className="flex min-h-app">
      <ContextPanel title="通讯录" className="max-md:hidden">
        <nav className="space-y-px pt-1">
          <DeptLink href={hrefFor(null)} label="全部成员" count={total} active={!deptId} />
          {flat.map((d) => (
            <DeptLink key={d.id} href={hrefFor(d.id)} label={d.name} count={countMap.get(d.id) ?? 0} depth={d.depth} active={deptId === d.id} />
          ))}
          {botCount > 0 && <DeptLink href={hrefFor(BOTS_KEY)} label="Webhook 机器人" count={botCount} active={showBotsOnly} />}
        </nav>
      </ContextPanel>
      <div className="min-w-0 flex-1">
        <TopBar mobileTitle="通讯录" crumbs={[{ label: "通讯录" }, { label: selectedName }]} actions={<SearchInput placeholder="搜索姓名、邮箱、职位、电话…" />} />
        <Page wide className="max-md:px-3">
          {/* 手机布局没有左侧部门栏，用横向滚动的部门标签代替 */}
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pt-1 [scrollbar-width:none] md:hidden">
            {[
              { id: null, label: "全部成员", count: total },
              ...flat.map((d) => ({ id: d.id, label: d.name, count: countMap.get(d.id) ?? 0 })),
              ...(botCount > 0 ? [{ id: BOTS_KEY, label: "Webhook 机器人", count: botCount }] : []),
            ].map((d) => {
              const active = (d.id ?? "") === deptId;
              return (
                <Link
                  key={d.id ?? "all"}
                  href={hrefFor(d.id)}
                  replace
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-[13px]",
                    active ? "border-accent bg-accent-soft text-accent" : "border-line bg-white text-ink-2",
                  )}
                >
                  {d.label}
                  <span className="ml-1 text-xs text-ink-3">{d.count}</span>
                </Link>
              );
            })}
          </div>
          {subDepts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-3">
              <span>下级部门</span>
              {subDepts.map((d) => (
                <Link key={d.id} href={hrefFor(d.id)} replace className="rounded-md px-1.5 py-0.5 text-accent hover:bg-hover">
                  {d.name}
                  <span className="ml-1 text-xs text-ink-3">{countMap.get(d.id) ?? 0}</span>
                </Link>
              ))}
            </div>
          )}
          {/* overflow-clip 而不是 overflow-hidden：保留圆角裁切，同时不打断手机端字母分组标题的吸顶 */}
          <div className="mt-4 divide-y divide-line overflow-clip rounded-lg border border-line bg-white max-md:mr-3">
            {users.length === 0 && bots.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<Users />} title="没有找到成员" description="换个搜索词或部门试试。" />
              </div>
            ) : (
              groups.flatMap(({ letter, items }) => [
                <div
                  key={`letter-${letter}`}
                  id={letterAnchorId(letter)}
                  className="sticky top-[calc(var(--sat)+2.75rem)] z-10 scroll-mt-[calc(var(--sat)+2.75rem)] bg-sidebar px-4 py-1 text-xs font-semibold text-ink-2 md:hidden"
                >
                  {letter}
                </div>,
                ...items.map((u) => (
                <MemberCard
                  key={u.id}
                  member={{
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    phone: u.phone,
                    title: u.title,
                    avatarColor: u.avatarColor,
                    departmentName: u.department?.name ?? null,
                    roleName: u.role.name,
                  }}
                >
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover">
                    <Avatar name={u.name} color={u.avatarColor} size={36} />
                    <span className="w-44 min-w-0 shrink-0">
                      <span className="block truncate text-sm font-medium text-ink">{u.name}</span>
                      <span className="block truncate text-xs text-ink-3">{u.title ?? "—"}</span>
                    </span>
                    <span className="hidden w-32 truncate text-sm text-ink-2 sm:block">{u.department?.name ?? "—"}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-sm text-ink-2 md:block">{u.email}</span>
                    <span className="hidden w-32 truncate text-sm text-ink-2 lg:block">{u.phone ?? "—"}</span>
                  </button>
                </MemberCard>
                )),
              ])
            )}
            {bots.map((b) => (
              <MemberCard
                key={b.id}
                member={{
                  id: b.id,
                  name: b.name,
                  email: "",
                  phone: null,
                  title: b.title ?? "Webhook 机器人",
                  avatarColor: b.avatarColor,
                  departmentName: null,
                  roleName: "Webhook 机器人",
                  isBot: true,
                  description: b.webhookConnector?.description ?? null,
                }}
              >
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover">
                  <Avatar name={b.name} color={b.avatarColor} size={36} />
                  <span className="w-44 min-w-0 shrink-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">{b.name}</span>
                      <Badge color="purple">
                        <Bot className="mr-0.5 size-3" />
                        机器人
                      </Badge>
                    </span>
                    <span className="block truncate text-xs text-ink-3">{b.title ?? "Webhook 机器人"}</span>
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-ink-2 sm:block">{b.webhookConnector?.description ?? "—"}</span>
                </button>
              </MemberCard>
            ))}
          </div>
        </Page>
        <LetterIndex letters={INDEX_LETTERS} available={groups.map((g) => g.letter)} />
      </div>
    </div>
  );
}
