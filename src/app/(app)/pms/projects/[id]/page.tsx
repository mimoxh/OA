import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { getActiveUsers } from "@/lib/crm/queries";
import { canEditProjectTasks, canManageProject } from "@/lib/pms/access";
import { toDateInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hrefWith } from "@/components/crm/view-switch";
import { ProjectActions, ProjectProperties, type HeaderProject } from "@/components/pms/project-header";
import type { BoardTask } from "@/components/pms/task-board";
import { ProjectTasks } from "@/components/pms/project-tasks";
import { ProjectPinButton } from "@/components/pms/project-pin-button";
import { upgradeProject } from "@/lib/pms/space";
import { Timeline } from "@/components/pms/timeline";
import { Milestones } from "@/components/pms/milestones";
import { Members } from "@/components/pms/members";
import { ProjectOverview } from "@/components/pms/project-overview";
import { TaskDialog } from "@/components/pms/task-dialog";
import { TaskDrawer, type DrawerTask } from "@/components/pms/task-drawer";
import { BizGroupButton } from "@/components/im/biz-group-button";
import { ShareToChatButton } from "@/components/im/share-to-chat";
import { bizDirectKey } from "@/lib/im/biz";

const VIEWS = [
  { key: "board", label: "看板" },
  { key: "list", label: "列表" },
  { key: "timeline", label: "时间线" },
  { key: "milestones", label: "里程碑" },
  { key: "members", label: "成员" },
  { key: "overview", label: "统计" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const TASK_VIEWS: View[] = ["board", "list", "timeline"];

export default async function ProjectPage({ params, searchParams }: PageProps<"/pms/projects/[id]">) {
  // 页面与布局并行渲染，下方 upgradeProject 会写库，所以权限必须在页面里先校验
  const user = await requirePermission("pms:view");
  const { id } = await params;
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "board";
  const taskId = typeof sp.task === "string" ? sp.task : null;

  const found = await db.project.findUnique({ where: { id } });
  if (!found) notFound();
  await upgradeProject(found);

  const project = await db.project.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, avatarColor: true, title: true, email: true } } },
        orderBy: { id: "asc" },
      },
      milestones: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], include: { tasks: { select: { status: true } } } },
      taskTypes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, color: true } },
    },
  });
  if (!project) notFound();

  const [tasks, logs, users, customers, canEdit, canManage, bizGroup] = await Promise.all([
    db.task.findMany({
      where: { projectId: id },
      orderBy: [{ sortOrder: "asc" }, { no: "asc" }],
      include: { assignee: { select: { name: true, avatarColor: true } }, milestone: { select: { name: true } }, type: { select: { id: true, name: true, color: true } } },
    }),
    db.timeLog.findMany({ where: { task: { projectId: id } }, select: { hours: true, userId: true, taskId: true } }),
    getActiveUsers(),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } }),
    canEditProjectTasks(user, id),
    canManageProject(user, id),
    db.conversation.findUnique({ where: { directKey: bizDirectKey("project", id) }, select: { id: true } }),
  ]);
  const commentCounts = await db.comment.groupBy({
    by: ["targetId"],
    where: { targetType: "task", targetId: { in: tasks.map((t) => t.id) } },
    _count: { _all: true },
  });

  const commentMap = new Map(commentCounts.map((c) => [c.targetId, c._count._all]));
  const top = tasks.filter((t) => !t.parentId);
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const childrenOf = (pid: string) => tasks.filter((t) => t.parentId === pid);
  const boardTasks: BoardTask[] = tasks.map((t) => {
    const subs = childrenOf(t.id);
    return {
      id: t.id,
      title: t.title,
      parent: t.parentId ? { id: t.parentId, title: titleOf.get(t.parentId) ?? "" } : null,
      type: t.type,
      typeId: t.typeId,
      milestoneId: t.milestoneId,
      status: t.status,
      priority: t.priority,
      sortOrder: t.sortOrder,
      dueDate: t.dueDate,
      assignee: t.assignee,
      assigneeId: t.assigneeId,
      subtaskTotal: subs.length,
      subtaskDone: subs.filter((s) => s.status === "DONE").length,
      commentCount: commentMap.get(t.id) ?? 0,
      milestone: t.milestone?.name ?? null,
    };
  });

  const memberUsers = project.members.map((m) => ({ id: m.user.id, name: m.user.name, avatarColor: m.user.avatarColor }));
  const milestoneOptions = project.milestones.map((m) => ({ id: m.id, name: m.name }));
  const path = `/pms/projects/${id}`;
  const taskHref = (tid: string) => hrefWith(path, sp, { task: tid });

  let drawer: DrawerTask | null = null;
  if (taskId) {
    const t = await db.task.findUnique({
      where: { id: taskId },
      include: {
        reporter: { select: { name: true, avatarColor: true } },
        parent: { select: { id: true, title: true } },
        subtasks: { orderBy: [{ sortOrder: "asc" }, { no: "asc" }], include: { assignee: { select: { name: true, avatarColor: true } } } },
        timeLogs: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { user: { select: { name: true, avatarColor: true } } } },
      },
    });
    if (t && t.projectId === id) {
      const [comments, activity] = await Promise.all([
        db.comment.findMany({
          where: { targetType: "task", targetId: t.id },
          orderBy: { createdAt: "asc" },
          include: { author: { select: { name: true, avatarColor: true } } },
        }),
        db.auditLog.findMany({
          where: { entityType: "task", entityId: t.id },
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { user: { select: { name: true, avatarColor: true } } },
        }),
      ]);
      drawer = {
        id: t.id,
        title: t.title,
        typeId: t.typeId,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assigneeId,
        reporter: t.reporter,
        startDate: t.startDate,
        dueDate: t.dueDate,
        estimateHours: t.estimateHours,
        milestoneId: t.milestoneId,
        parent: t.parent,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status, assignee: s.assignee })),
        timeLogs: t.timeLogs.map((l) => ({ id: l.id, hours: l.hours, date: l.date, note: l.note, userId: l.userId, user: l.user })),
        comments: comments.map((c) => ({ id: c.id, content: c.content, createdAt: c.createdAt, authorId: c.authorId, author: c.author })),
        activity: activity.map((a) => ({ id: a.id, detail: a.detail, createdAt: a.createdAt, user: a.user })),
      };
    }
  }

  const header: HeaderProject = {
    id: project.id,
    name: project.name,
    icon: project.icon,
    status: project.status,
    ownerId: project.ownerId,
    spaceId: project.spaceId,
    customer: project.customer,
    startDate: project.startDate,
    endDate: project.endDate,
    budget: project.budget,
    members: memberUsers,
    total: top.length,
    done: top.filter((t) => t.status === "DONE").length,
    form: {
      name: project.name,
      description: project.description ?? "",
      icon: project.icon,
      color: project.color,
      status: project.status,
      ownerId: project.ownerId,
      customerId: project.customerId ?? "",
      startDate: toDateInput(project.startDate),
      endDate: toDateInput(project.endDate),
      budget: project.budget ? String(project.budget) : "",
    },
  };

  return (
    <>
      <TopBar
        crumbs={[{ label: "PMS 项目", href: "/pms" }, { label: `${project.icon} ${project.name}` }]}
        mobileTitle={`${project.icon} ${project.name}`}
        mobileActions={
          canEdit && (
            <TaskDialog
              projectId={id}
              members={memberUsers}
              milestones={milestoneOptions}
              types={project.taskTypes}
              trigger={
                <Button variant="primary" size="sm" aria-label="新建任务">
                  <Plus className="size-3.5" />
                  任务
                </Button>
              }
            />
          )
        }
        mobileMore={
          <>
            <BizGroupButton bizType="project" bizId={project.id} existingConversationId={bizGroup?.id} />
            <ShareToChatButton refType="project" refId={project.id} title={project.name} subtitle={project.customer?.name ?? "内部项目"} />
            <ProjectPinButton projectId={project.id} name={project.name} pinned={user.railPins.includes(`project:${project.id}`)} />
            <ProjectActions
              project={header}
              users={users}
              customers={customers}
              canManage={canManage}
              canDelete={can(user, "pms:edit")}
              currentUserId={user.id}
              labeled
            />
          </>
        }
        actions={
          <>
            <BizGroupButton bizType="project" bizId={project.id} existingConversationId={bizGroup?.id} />
            <ShareToChatButton refType="project" refId={project.id} title={project.name} subtitle={project.customer?.name ?? "内部项目"} />
            <ProjectPinButton projectId={project.id} name={project.name} pinned={user.railPins.includes(`project:${project.id}`)} />
            <ProjectActions
              project={header}
              users={users}
              customers={customers}
              canManage={canManage}
              canDelete={can(user, "pms:edit")}
              currentUserId={user.id}
            />
            {canEdit && (
              <TaskDialog
                projectId={id}
                members={memberUsers}
                milestones={milestoneOptions}
                types={project.taskTypes}
                trigger={
                  <Button variant="primary">
                    <Plus className="size-3.5" />
                    新建任务
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <Page wide>
        <PageHeader
          icon={
            <span className="inline-flex size-14 items-center justify-center rounded-xl text-[34px]" style={{ backgroundColor: `${project.color}1f` }}>
              {project.icon}
            </span>
          }
          title={project.name}
          description={project.description}
        />
        <ProjectProperties project={header} users={users} canManage={canManage} />

        <div className="mt-6 mb-5 flex items-center gap-1 border-b border-line max-md:mt-4 max-md:mb-3">
          {/* 手机上看板 / 列表 / 时间线合并为一个「任务」标签（按状态分组的列表） */}
          <Link
            href={hrefWith(path, {}, { view: null })}
            scroll={false}
            replace
            className={cn(
              "relative -mb-px flex h-9 items-center px-2 text-sm transition-colors md:hidden",
              TASK_VIEWS.includes(view) ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-ink-2",
            )}
          >
            任务
          </Link>
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={hrefWith(path, {}, { view: v.key === "board" ? null : v.key })}
              scroll={false}
              className={cn(
                "relative -mb-px flex h-9 items-center px-2 text-sm transition-colors",
                view === v.key ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-ink-2 hover:text-ink",
                TASK_VIEWS.includes(v.key) && "max-md:hidden",
              )}
            >
              {v.label}
              {v.key === "milestones" && <span className="ml-1 rounded bg-hover px-1 text-[11px] text-ink-2">{project.milestones.length}</span>}
              {v.key === "members" && <span className="ml-1 rounded bg-hover px-1 text-[11px] text-ink-2">{project.members.length}</span>}
            </Link>
          ))}
          {!canEdit && <span className="ml-auto text-xs text-ink-3 max-md:hidden">只读：你不是该项目成员</span>}
        </div>

        {(view === "board" || view === "list") && (
          <ProjectTasks
            view={view}
            projectId={id}
            tasks={boardTasks}
            members={memberUsers}
            types={project.taskTypes}
            milestones={milestoneOptions}
            canEdit={canEdit}
            canManage={canManage}
            meId={user.id}
          />
        )}
        {view === "timeline" && (
          <div className="md:hidden">
            <ProjectTasks
              view="mobile"
              projectId={id}
              tasks={boardTasks}
              members={memberUsers}
              types={project.taskTypes}
              milestones={milestoneOptions}
              canEdit={canEdit}
              canManage={canManage}
              meId={user.id}
            />
          </div>
        )}
        {view === "timeline" && (
          <div className="max-md:hidden">
          <Timeline
            tasks={top.map((t) => ({ id: t.id, title: t.title, status: t.status, startDate: t.startDate, dueDate: t.dueDate, assignee: t.assignee }))}
            milestones={project.milestones.map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate, status: m.status }))}
            projectStart={project.startDate}
            projectEnd={project.endDate}
            taskHref={taskHref}
          />
          </div>
        )}
        {view === "milestones" && (
          <Milestones
            projectId={id}
            canManage={canManage}
            milestones={project.milestones.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              dueDate: m.dueDate,
              status: m.status,
              total: m.tasks.length,
              done: m.tasks.filter((t) => t.status === "DONE").length,
            }))}
          />
        )}
        {view === "members" && (
          <Members
            projectId={id}
            ownerId={project.ownerId}
            users={users}
            canManage={canManage}
            members={[...project.members]
              .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0))
              .map((m) => ({
                id: m.id,
                role: m.role,
                user: m.user,
                open: tasks.filter((t) => t.assigneeId === m.user.id && t.status !== "DONE").length,
                done: tasks.filter((t) => t.assigneeId === m.user.id && t.status === "DONE").length,
                hours: logs.filter((l) => l.userId === m.user.id).reduce((s, l) => s + l.hours, 0),
              }))}
          />
        )}
        {view === "overview" && <ProjectOverview tasks={tasks} logs={logs} people={users} taskHref={taskHref} />}
      </Page>

      {drawer && (
        <TaskDrawer
          key={drawer.id}
          task={drawer}
          projectId={id}
          members={memberUsers}
          milestones={milestoneOptions}
          types={project.taskTypes}
          parentOptions={top.filter((t) => t.id !== drawer.id).map((t) => ({ id: t.id, title: t.title }))}
          canEdit={canEdit}
          canManage={canManage}
          currentUserId={user.id}
        />
      )}
    </>
  );
}
