import { AlertTriangle, CheckCircle2, Clock, ListTodo } from "lucide-react";
import Link from "next/link";
import { Card, Section, StatCard } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { UserChip } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDate, formatNumber } from "@/lib/format";
import { isOverdue, taskKey, TASK_STATUS_ORDER } from "@/lib/pms/utils";

const STATUS_COLOR: Record<string, string> = { TODO: "#a5a29c", IN_PROGRESS: "#337ea9", REVIEW: "#9065b0", DONE: "#448361" };

type OTask = {
  id: string;
  no: number;
  title: string;
  status: keyof typeof TASK_STATUS;
  priority: keyof typeof TASK_PRIORITY;
  dueDate: Date | null;
  estimateHours: number | null;
  assigneeId: string | null;
  assignee: { name: string; avatarColor: string } | null;
};

export function ProjectOverview({
  code,
  tasks,
  logs,
  people,
  taskHref,
}: {
  code: string;
  tasks: OTask[];
  logs: { hours: number; userId: string }[];
  people: { id: string; name: string; avatarColor: string }[];
  taskHref: (id: string) => string;
}) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.status)).sort((a, b) => +a.dueDate! - +b.dueDate!);
  const hours = logs.reduce((s, l) => s + l.hours, 0);
  const estimate = tasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  const byStatus = TASK_STATUS_ORDER.map((s) => ({ s, n: tasks.filter((t) => t.status === s).length }));

  const ids = [...new Set([...tasks.map((t) => t.assigneeId), ...logs.map((l) => l.userId)])];
  const rows = ids
    .map((id) => {
      const mine = tasks.filter((t) => t.assigneeId === id);
      const person = id ? people.find((p) => p.id === id) : null;
      return {
        id: id ?? "none",
        person,
        total: mine.length,
        open: mine.filter((t) => t.status !== "DONE").length,
        done: mine.filter((t) => t.status === "DONE").length,
        overdue: mine.filter((t) => isOverdue(t.dueDate, t.status)).length,
        hours: logs.filter((l) => l.userId === id).reduce((s, l) => s + l.hours, 0),
      };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="任务总数" value={total} icon={<ListTodo />} hint={`进行中 ${tasks.filter((t) => t.status === "IN_PROGRESS").length}`} />
        <StatCard label="已完成" value={done} icon={<CheckCircle2 />} hint={total ? `完成率 ${Math.round((done / total) * 100)}%` : "—"} />
        <StatCard label="逾期任务" value={<span className={overdue.length ? "text-danger" : ""}>{overdue.length}</span>} icon={<AlertTriangle />} />
        <StatCard label="工时合计" value={`${formatNumber(hours, 1)} h`} icon={<Clock />} hint={`预估 ${formatNumber(estimate, 1)} h`} />
      </div>

      <Section title="任务状态分布">
        <Card className="p-4">
          <div className="flex h-3 overflow-hidden rounded-full bg-hover">
            {byStatus.map(({ s, n }) => (total ? <span key={s} style={{ width: `${(n / total) * 100}%`, backgroundColor: STATUS_COLOR[s] }} title={`${TASK_STATUS[s].label} ${n}`} /> : null))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {byStatus.map(({ s, n }) => (
              <div key={s} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLOR[s] }} />
                <span className="text-ink-2">{TASK_STATUS[s].label}</span>
                <span className="ml-auto font-medium tabular-nums">{n}</span>
                <span className="w-10 text-right text-xs tabular-nums text-ink-3">{total ? Math.round((n / total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="按负责人统计">
        <Table>
          <THead>
            <TR>
              <TH>负责人</TH>
              <TH className="text-right">任务</TH>
              <TH className="text-right">未完成</TH>
              <TH className="text-right">已完成</TH>
              <TH className="text-right">逾期</TH>
              <TH className="text-right">登记工时</TH>
              <TH className="w-1/4">完成度</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && <TEmpty colSpan={7} />}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>{r.person ? <UserChip name={r.person.name} color={r.person.avatarColor} /> : <span className="text-ink-3">未指派</span>}</TD>
                <TD className="text-right tabular-nums">{r.total}</TD>
                <TD className="text-right tabular-nums">{r.open}</TD>
                <TD className="text-right tabular-nums text-ink-2">{r.done}</TD>
                <TD className={`text-right tabular-nums ${r.overdue ? "font-medium text-danger" : "text-ink-3"}`}>{r.overdue}</TD>
                <TD className="text-right tabular-nums">{formatNumber(r.hours, 1)} h</TD>
                <TD>
                  <div className="h-1.5 overflow-hidden rounded-full bg-hover">
                    <div className="h-full rounded-full bg-[#448361]" style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title={`逾期任务（${overdue.length}）`}>
        <Table>
          <THead>
            <TR>
              <TH>任务</TH>
              <TH>状态</TH>
              <TH>优先级</TH>
              <TH>负责人</TH>
              <TH>截止日期</TH>
            </TR>
          </THead>
          <TBody>
            {overdue.length === 0 && <TEmpty colSpan={5}>没有逾期任务 🎉</TEmpty>}
            {overdue.map((t) => (
              <TR key={t.id}>
                <TD>
                  <Link href={taskHref(t.id)} scroll={false} className="hover:text-accent hover:underline">
                    <span className="mr-1.5 font-mono text-xs text-ink-3">{taskKey(code, t.no)}</span>
                    {t.title}
                  </Link>
                </TD>
                <TD>
                  <StatusBadge map={TASK_STATUS} value={t.status} />
                </TD>
                <TD>
                  <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                </TD>
                <TD>
                  <UserChip name={t.assignee?.name} color={t.assignee?.avatarColor} />
                </TD>
                <TD className="text-danger">{formatDate(t.dueDate)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </div>
  );
}
