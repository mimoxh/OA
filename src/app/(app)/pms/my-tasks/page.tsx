import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader, EmptyState } from "@/components/ui/page";
import { ViewSwitch } from "@/components/crm/view-switch";
import { DUE_BUCKETS, dueBucket } from "@/lib/pms/utils";
import { MyTaskList, type MyTask } from "@/components/pms/my-task-list";

export default async function MyTasksPage({ searchParams }: PageProps<"/pms/my-tasks">) {
  const user = await requireUser();
  const sp = await searchParams;
  const showDone = sp.done === "1";

  const tasks = await db.task.findMany({
    where: { assigneeId: user.id, ...(showDone ? { status: "DONE" } : { status: { not: "DONE" } }) },
    orderBy: showDone ? [{ completedAt: "desc" }] : [{ dueDate: "asc" }, { priority: "desc" }],
    take: showDone ? 50 : undefined,
    include: {
      project: { select: { id: true, name: true, code: true, icon: true } },
      parent: { select: { no: true, title: true } },
    },
  });
  const rows: MyTask[] = tasks.map((t) => ({
    id: t.id,
    no: t.no,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    parentTitle: t.parent?.title ?? null,
    project: t.project,
  }));

  const now = new Date();
  const groups = DUE_BUCKETS.map((b) => ({ ...b, tasks: rows.filter((t) => dueBucket(t.dueDate, now) === b.key) })).filter((g) => g.tasks.length > 0);

  return (
    <>
      <TopBar crumbs={[{ label: "PMS 项目", href: "/pms" }, { label: "我的任务" }]} />
      <Page>
        <PageHeader
          icon="✅"
          title="我的任务"
          description={showDone ? "最近完成的 50 个任务" : `跨项目指派给我的未完成任务，共 ${rows.length} 个`}
          actions={
            <ViewSwitch
              items={[
                { href: "/pms/my-tasks", label: "未完成", active: !showDone },
                { href: "/pms/my-tasks?done=1", label: "已完成", active: showDone },
              ]}
            />
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={showDone ? "📭" : "🎉"}
            title={showDone ? "还没有完成的任务" : "没有待处理的任务"}
            description={
              <>
                去{" "}
                <Link href="/pms" className="text-accent hover:underline">
                  项目列表
                </Link>{" "}
                看看团队的进展吧。
              </>
            }
          />
        ) : showDone ? (
          <MyTaskList tasks={rows} />
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className={`mb-1.5 flex items-center gap-1.5 text-[15px] font-semibold ${g.key === "overdue" ? "text-danger" : "text-ink"}`}>
                  <span>{g.icon}</span>
                  {g.label}
                  <span className="text-xs font-normal text-ink-3">{g.tasks.length}</span>
                </h2>
                <MyTaskList tasks={g.tasks} />
              </section>
            ))}
          </div>
        )}
      </Page>
    </>
  );
}
