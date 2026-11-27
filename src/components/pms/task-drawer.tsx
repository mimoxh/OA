"use client";

import { Fragment, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog as D } from "radix-ui";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  CircleDot,
  Clock,
  CornerLeftUp,
  Diamond,
  Flag,
  Link2,
  MoreHorizontal,
  Plus,
  Tag,
  Timer,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { copyWithToast } from "@/lib/clipboard";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Properties, Property } from "@/components/ui/page";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { useAction } from "@/components/ui/use-action";
import { InlineDate, InlineSelect, InlineText } from "@/components/crm/inline";
import { formatDate, formatDateTime, formatNumber, formatRelative, toDateInput } from "@/lib/format";
import { TASK_STATUS } from "@/lib/labels";
import { asTagColor, isOverdue } from "@/lib/pms/utils";
import { Badge } from "@/components/ui/badge";
import type { UserOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import {
  addTaskComment,
  addTimeLog,
  createTask,
  deleteTask,
  deleteTaskComment,
  deleteTimeLog,
  updateTask,
  type TaskInput,
} from "@/app/(app)/pms/actions";
import { priorityOptions, statusOptions } from "@/components/pms/task-list";
import { navigateBack } from "@/components/mobile/nav-stack";
import { useIsMobileLayout } from "@/components/mobile/use-mobile-layout";

type Person = { name: string; avatarColor: string };

export type DrawerTask = {
  id: string;
  title: string;
  typeId: string | null;
  description: string | null;
  status: keyof typeof TASK_STATUS;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeId: string | null;
  reporter: Person;
  startDate: Date | null;
  dueDate: Date | null;
  estimateHours: number | null;
  milestoneId: string | null;
  parent: { id: string; title: string } | null;
  createdAt: Date;
  completedAt: Date | null;
  subtasks: { id: string; title: string; status: keyof typeof TASK_STATUS; assignee: Person | null }[];
  timeLogs: { id: string; hours: number; date: Date; note: string | null; userId: string; user: Person }[];
  comments: { id: string; content: string; createdAt: Date; authorId: string; author: Person }[];
  activity: { id: string; detail: string | null; createdAt: Date; user: Person | null }[];
};

function MentionText({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") && names.includes(p.slice(1)) ? (
          <span key={i} className="rounded bg-accent-soft px-0.5 text-accent">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function CommentBox({ taskId, members, disabled }: { taskId: string; members: UserOption[]; disabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const { run, pending } = useAction();
  const matches = mention ? members.filter((m) => m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,20})$/.exec(before);
    if (m) {
      setMention({ start: caret - m[2].length - 1, query: m[2] });
      setActive(0);
    } else setMention(null);
  };
  const pick = (u: UserOption) => {
    if (!mention) return;
    const caret = mention.start + 1 + mention.query.length;
    const next = `${value.slice(0, mention.start)}@${u.name} ${value.slice(caret)}`;
    setValue(next);
    setMention(null);
    const pos = mention.start + u.name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };
  const submit = () => {
    if (!value.trim()) return;
    run(() => addTaskComment(taskId, value), { success: "评论已发布", onSuccess: () => setValue("") });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={3}
        value={value}
        disabled={disabled || pending}
        placeholder="写评论，输入 @ 提及成员，Ctrl + Enter 发送"
        onChange={(e) => {
          setValue(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (mention && matches.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setMention(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full rounded-md border border-line-strong bg-white px-2.5 py-1.5 text-sm leading-relaxed placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
      />
      {mention && matches.length > 0 && (
        <div className="absolute left-2 top-full z-30 mt-1 w-56 rounded-md bg-white p-1 shadow-pop" data-testid="mention-list">
          {matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(u);
              }}
              className={cn("flex h-7 w-full items-center gap-2 rounded px-2 text-left text-sm", i === active ? "bg-hover" : "hover:bg-hover")}
            >
              <Avatar name={u.name} color={u.avatarColor} size={18} />
              {u.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex justify-end">
        <Button size="sm" variant="primary" loading={pending} disabled={!value.trim() || disabled} onClick={submit}>
          发送
        </Button>
      </div>
    </div>
  );
}

export function TaskDrawer({
  task,
  projectId,
  members,
  milestones,
  types,
  parentOptions,
  canEdit,
  canManage,
  currentUserId,
}: {
  task: DrawerTask;
  projectId: string;
  members: UserOption[];
  milestones: { id: string; name: string }[];
  types: { id: string; name: string; color: string }[];
  parentOptions: { id: string; title: string }[];
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { run, pending } = useAction();
  const [subDraft, setSubDraft] = useState("");
  const [log, setLog] = useState({ hours: "", date: toDateInput(new Date()), note: "" });
  const ro = !canEdit;
  const t = task;
  const save = (patch: TaskInput) => updateTask(t.id, patch);

  const go = (taskId: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (taskId) next.set("task", taskId);
    else next.delete("task");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const mobile = useIsMobileLayout();
  // 手机上任务详情是全屏页：关闭 = 返回项目（与返回键、顶栏返回同一套层级）
  const close = () => (mobile ? navigateBack(router) : go(null));

  const memberOptions = members.map((u) => ({ value: u.id, label: <UserChip name={u.name} color={u.avatarColor} /> }));
  const totalHours = t.timeLogs.reduce((s, l) => s + l.hours, 0);
  const subDone = t.subtasks.filter((s) => s.status === "DONE").length;
  const memberNames = members.map((m) => m.name);

  return (
    <D.Root open onOpenChange={(v) => !v && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/15 animate-fade-in max-md:hidden" />
        <D.Content
          aria-describedby={undefined}
          className="fixed bottom-0 right-0 top-app z-40 flex w-[min(640px,100vw)] flex-col bg-white shadow-pop animate-fade-in focus:outline-none max-md:top-0 max-md:w-full max-md:pt-[var(--sat)] max-md:pb-[var(--sab)] max-md:shadow-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-4 max-md:px-2">
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
              <button type="button" onClick={close} className="shrink-0 rounded-md p-1 text-ink-2 active:bg-hover md:hidden" aria-label="返回">
                <ChevronLeft className="size-6" />
              </button>
              {t.parent && (
                <>
                  <button onClick={() => go(t.parent!.id)} className="inline-flex min-w-0 items-center gap-1 rounded px-1 hover:bg-hover hover:text-ink">
                    <CornerLeftUp className="size-3.5 shrink-0" />
                    <span className="truncate">{t.parent.title}</span>
                  </button>
                  <span className="text-ink-3">/</span>
                </>
              )}
              <span className="text-xs">{t.parent ? "子任务" : "任务"}</span>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                aria-label="复制链接"
                title="复制链接"
                onClick={() => {
                  void copyWithToast(`${window.location.origin}/pms/projects/${projectId}?task=${t.id}`, "链接已复制");
                }}
              >
                <Link2 className="size-4" />
              </IconButton>
              {canEdit && (
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton aria-label="更多操作">
                      <MoreHorizontal className="size-4" />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem
                      danger
                      icon={<Trash2 />}
                      onSelect={() =>
                        run(() => deleteTask(t.id), {
                          success: "任务已删除",
                          onSuccess: (d) => go(d.parentId),
                        })
                      }
                    >
                      删除任务{t.subtasks.length ? `（含 ${t.subtasks.length} 个子任务）` : ""}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
              <D.Close asChild>
                <IconButton aria-label="关闭" className="max-md:hidden">
                  <X className="size-4" />
                </IconButton>
              </D.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-16 max-md:px-4">
            <D.Title asChild>
              <div className="pt-5">
                <InlineText
                  readOnly={ro}
                  value={t.title}
                  onSave={(v) => (v ? save({ title: v }) : Promise.resolve({ ok: false as const, error: "标题不能为空" }))}
                  className="text-xl font-bold leading-snug"
                  display={<span className={cn("text-xl font-bold leading-snug text-ink", t.status === "DONE" && "line-through decoration-ink-3")}>{t.title}</span>}
                />
              </div>
            </D.Title>

            <div className="mt-3">
              <Properties>
                <Property label="状态" icon={<CircleDot />}>
                  <InlineSelect readOnly={ro} value={t.status} options={statusOptions} onSave={(v) => save({ status: v as "TODO" })} />
                </Property>
                <Property label="类型" icon={<Tag />}>
                  <InlineSelect
                    readOnly={ro}
                    allowEmpty
                    emptyLabel="未分类"
                    placeholder="未分类"
                    value={t.typeId}
                    options={types.map((ty) => ({ value: ty.id, label: <Badge color={asTagColor(ty.color)}>{ty.name}</Badge> }))}
                    onSave={(v) => save({ typeId: v || null })}
                  />
                </Property>
                <Property label="优先级" icon={<Flag />}>
                  <InlineSelect readOnly={ro} value={t.priority} options={priorityOptions} onSave={(v) => save({ priority: v as "LOW" })} />
                </Property>
                <Property label="负责人" icon={<UserRound />}>
                  <InlineSelect
                    readOnly={ro}
                    allowEmpty
                    emptyLabel="取消指派"
                    placeholder="未指派"
                    value={t.assigneeId}
                    options={memberOptions}
                    onSave={(v) => save({ assigneeId: v || null })}
                  />
                </Property>
                <Property label="开始日期" icon={<CalendarDays />}>
                  <InlineDate readOnly={ro} value={toDateInput(t.startDate)} display={formatDate(t.startDate)} onSave={(v) => save({ startDate: v || null })} />
                </Property>
                <Property label="截止日期" icon={<CalendarClock />}>
                  <InlineDate
                    readOnly={ro}
                    value={toDateInput(t.dueDate)}
                    display={formatDate(t.dueDate)}
                    className={cn(isOverdue(t.dueDate, t.status) && "text-danger")}
                    onSave={(v) => save({ dueDate: v || null })}
                  />
                </Property>
                <Property label="预估工时" icon={<Timer />}>
                  <InlineText
                    readOnly={ro}
                    type="number"
                    value={t.estimateHours === null ? "" : String(t.estimateHours)}
                    display={t.estimateHours === null ? <span className="text-ink-3">未估算</span> : `${formatNumber(t.estimateHours, 1)} 小时`}
                    onSave={(v) => save({ estimateHours: v || null })}
                  />
                </Property>
                <Property label="里程碑" icon={<Diamond />}>
                  <InlineSelect
                    readOnly={ro}
                    allowEmpty
                    emptyLabel="不关联"
                    placeholder="无"
                    value={t.milestoneId}
                    options={milestones.map((m) => ({ value: m.id, label: <span>◆ {m.name}</span> }))}
                    onSave={(v) => save({ milestoneId: v || null })}
                  />
                </Property>
                {t.subtasks.length === 0 && (
                  <Property label="父任务" icon={<CornerLeftUp />}>
                    <InlineSelect
                      readOnly={ro}
                      allowEmpty
                      emptyLabel="无父任务"
                      placeholder="无"
                      value={t.parent?.id ?? null}
                      options={parentOptions
                        .filter((p) => p.id !== t.id)
                        .map((p) => ({
                          value: p.id,
                          label: <span className="truncate">{p.title}</span>,
                        }))}
                      onSave={(v) => save({ parentId: v || null })}
                    />
                  </Property>
                )}
                <Property label="报告人" icon={<UserRound />}>
                  <UserChip name={t.reporter.name} color={t.reporter.avatarColor} />
                </Property>
                <Property label="创建时间" icon={<Clock />}>
                  <span className="text-ink-2">
                    {formatDateTime(t.createdAt)}
                    {t.completedAt && <span className="ml-2 text-[#448361]">· 完成于 {formatDateTime(t.completedAt)}</span>}
                  </span>
                </Property>
              </Properties>
            </div>

            <section className="mt-5">
              <h3 className="mb-1 text-xs font-medium text-ink-2">描述</h3>
              <InlineText readOnly={ro} multiline placeholder="添加描述…" value={t.description} onSave={(v) => save({ description: v || null })} />
            </section>

            <section className="mt-6">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-medium text-ink-2">
                  子任务 {t.subtasks.length > 0 && `${subDone}/${t.subtasks.length}`}
                </h3>
              </div>
              {t.subtasks.length > 0 && (
                <div className="mb-1 h-1 overflow-hidden rounded-full bg-hover">
                  <div className="h-full bg-[#448361] transition-all" style={{ width: `${(subDone / t.subtasks.length) * 100}%` }} />
                </div>
              )}
              <ul>
                {t.subtasks.map((s) => (
                  <li key={s.id} className="group flex h-8 items-center gap-2 rounded px-1 hover:bg-hover">
                    <input
                      type="checkbox"
                      aria-label={`完成 ${s.title}`}
                      className="size-3.5 accent-accent"
                      checked={s.status === "DONE"}
                      disabled={ro || pending}
                      onChange={(e) => run(() => updateTask(s.id, { status: e.target.checked ? "DONE" : "TODO" }))}
                    />
                    <button onClick={() => go(s.id)} className={cn("min-w-0 flex-1 truncate text-left text-sm hover:text-accent", s.status === "DONE" && "text-ink-3 line-through")}>
                      {s.title}
                    </button>
                    {s.assignee && <Avatar name={s.assignee.name} color={s.assignee.avatarColor} size={18} />}
                    {canEdit && (
                      <IconButton className="opacity-0 group-hover:opacity-100" aria-label="删除子任务" onClick={() => run(() => deleteTask(s.id), { success: "子任务已删除" })}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && !t.parent && (
                <form
                  className="mt-1 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const title = subDraft.trim();
                    if (!title) return;
                    run(() => createTask(projectId, { title, parentId: t.id, assigneeId: t.assigneeId, typeId: t.typeId }), { success: "子任务已添加", onSuccess: () => setSubDraft("") });
                  }}
                >
                  <Plus className="size-3.5 text-ink-3" />
                  <input
                    value={subDraft}
                    onChange={(e) => setSubDraft(e.target.value)}
                    placeholder="添加子任务，回车保存"
                    className="h-7 flex-1 rounded border border-transparent px-1.5 text-sm outline-none placeholder:text-ink-3 hover:bg-hover focus:border-accent focus:bg-white"
                  />
                </form>
              )}
            </section>

            <section className="mt-6">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-medium text-ink-2">工时记录</h3>
                <span className="text-xs text-ink-2">
                  合计 <span className="font-semibold text-ink tabular-nums">{formatNumber(totalHours, 1)}</span> 小时
                  {t.estimateHours ? ` / 预估 ${formatNumber(t.estimateHours, 1)} 小时` : ""}
                </span>
              </div>
              {t.estimateHours ? (
                <div className="mb-2 h-1 overflow-hidden rounded-full bg-hover">
                  <div className={cn("h-full", totalHours > t.estimateHours ? "bg-danger" : "bg-accent")} style={{ width: `${Math.min(100, (totalHours / t.estimateHours) * 100)}%` }} />
                </div>
              ) : null}
              {canEdit && (
                <form
                  className="mb-2 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => addTimeLog(t.id, log), { success: "工时已登记", onSuccess: () => setLog((l) => ({ ...l, hours: "", note: "" })) });
                  }}
                >
                  <Input type="number" min={0.5} max={24} step={0.5} placeholder="小时" value={log.hours} onChange={(e) => setLog((l) => ({ ...l, hours: e.target.value }))} className="h-7 w-20 text-[13px]" />
                  <Input type="date" value={log.date} onChange={(e) => setLog((l) => ({ ...l, date: e.target.value }))} className="h-7 w-36 text-[13px]" />
                  <Input placeholder="工作内容（可选）" value={log.note} onChange={(e) => setLog((l) => ({ ...l, note: e.target.value }))} className="h-7 flex-1 text-[13px]" />
                  <Button type="submit" size="sm" disabled={!log.hours} loading={pending}>
                    登记
                  </Button>
                </form>
              )}
              <ul className="divide-y divide-line">
                {t.timeLogs.length === 0 && <li className="py-2 text-xs text-ink-3">暂无工时记录</li>}
                {t.timeLogs.map((l) => (
                  <li key={l.id} className="group flex h-8 items-center gap-2 text-[13px]">
                    <span className="w-20 shrink-0 tabular-nums text-ink-2">{formatDate(l.date, "MM-dd")}</span>
                    <UserChip name={l.user.name} color={l.user.avatarColor} />
                    <span className="min-w-0 flex-1 truncate text-ink-2">{l.note}</span>
                    <span className="shrink-0 font-medium tabular-nums">{formatNumber(l.hours, 1)} h</span>
                    {(l.userId === currentUserId || canManage) && (
                      <IconButton className="opacity-0 group-hover:opacity-100" aria-label="删除工时" onClick={() => run(() => deleteTimeLog(l.id), { success: "已删除" })}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-6">
              <h3 className="mb-2 text-xs font-medium text-ink-2">评论（{t.comments.length}）</h3>
              <ul className="mb-3 space-y-3">
                {t.comments.map((c) => (
                  <li key={c.id} className="group flex gap-2.5">
                    <Avatar name={c.author.name} color={c.author.avatarColor} size={26} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="font-medium">{c.author.name}</span>
                        <span className="text-xs text-ink-3" title={formatDateTime(c.createdAt)}>
                          {formatRelative(c.createdAt)}
                        </span>
                        {(c.authorId === currentUserId || canManage) && (
                          <IconButton className="ml-auto opacity-0 group-hover:opacity-100" aria-label="删除评论" onClick={() => run(() => deleteTaskComment(c.id), { success: "评论已删除" })}>
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        )}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                        <MentionText text={c.content} names={memberNames} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {canEdit ? <CommentBox taskId={t.id} members={members} /> : <p className="text-xs text-ink-3">只有项目成员可以评论</p>}
            </section>

            <section className="mt-6">
              <h3 className="mb-2 text-xs font-medium text-ink-2">活动</h3>
              <ol className="space-y-2 border-l border-line pl-3">
                {t.activity.map((a) => (
                  <li key={a.id} className="relative text-[13px] text-ink-2">
                    <span className="absolute -left-[16.5px] top-1.5 size-2 rounded-full border border-line-strong bg-white" />
                    <span className="font-medium text-ink">{a.user?.name ?? "系统"}</span> {a.detail}
                    <span className="ml-1.5 text-xs text-ink-3" title={formatDateTime(a.createdAt)}>
                      {formatRelative(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
