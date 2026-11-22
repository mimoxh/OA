import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Check, CircleDashed, Clock, ExternalLink, Flag, RotateCcw, Send, X } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { parseFormSchema, parseSteps, type FormField } from "@/lib/services/approval";
import { APPROVAL_STATUS, APPROVAL_TASK_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelative } from "@/lib/format";
import { parseFormData } from "@/lib/oa/form";
import { canViewApproval, previewSteps, type StepPreview } from "@/lib/oa/server";
import { Card, EmptyState, Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { NotificationsChanged } from "@/components/oa/notifications-changed";
import { cn } from "@/lib/utils";
import { DecisionBar, WithdrawButton } from "./approval-actions";
import { ApprovalComments } from "./approval-comments";
import { ShareToChatButton } from "@/components/im/share-to-chat";

type NodeState = "approved" | "rejected" | "pending" | "waiting" | "skipped";

const NODE_META: Record<NodeState, { label: string; color: "green" | "red" | "blue" | "gray"; dot: string }> = {
  approved: { label: "已同意", color: "green", dot: "bg-[#448361] text-white" },
  rejected: { label: "已驳回", color: "red", dot: "bg-[#d44c47] text-white" },
  pending: { label: "审批中", color: "blue", dot: "bg-accent text-white ring-4 ring-accent/15" },
  waiting: { label: "待审批", color: "gray", dot: "border border-line-strong bg-white text-ink-3" },
  skipped: { label: "未执行", color: "gray", dot: "border border-line-strong bg-white text-ink-3" },
};

function NodeIcon({ state }: { state: NodeState }) {
  if (state === "approved") return <Check className="size-3" />;
  if (state === "rejected") return <X className="size-3" />;
  if (state === "pending") return <Clock className="size-3" />;
  return <CircleDashed className="size-3" />;
}

export default async function ApprovalDetailPage({ params }: PageProps<"/oa/approvals/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const inst = await db.approvalInstance.findUnique({
    where: { id },
    include: {
      flow: true,
      applicant: { include: { department: { select: { name: true } } } },
      tasks: {
        include: { approver: { select: { id: true, name: true, avatarColor: true, title: true } } },
        orderBy: [{ step: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!inst) notFound();
  if (!canViewApproval(user, inst)) {
    return (
      <>
        <TopBar crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "审批中心", href: "/oa/approvals" }, { label: "无权查看" }]} />
        <Page>
          <div className="pt-16">
            <EmptyState icon="🔒" title="你无权查看该审批单" description="只有申请人、审批人和 OA 管理员可以查看" />
          </div>
        </Page>
      </>
    );
  }

  const link = `/oa/approvals/${inst.id}`;
  const fields = parseFormSchema(inst.flow.formSchema);
  const data = parseFormData(inst.formData);
  const userFieldIds = fields.filter((f) => f.type === "user" && typeof data[f.name] === "string").map((f) => String(data[f.name]));

  const [refUsers, comments, marked, preview, po, voucher] = await Promise.all([
    db.user.findMany({ where: { id: { in: userFieldIds } }, select: { id: true, name: true, avatarColor: true } }),
    db.comment.findMany({
      where: { targetType: "approval", targetId: inst.id },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.notification.updateMany({ where: { userId: user.id, read: false, link }, data: { read: true } }),
    inst.status === "PENDING" ? previewSteps(parseSteps(inst.flow.steps), inst.applicantId) : Promise.resolve([] as StepPreview[]),
    inst.bizType === "purchase_order" && inst.bizId
      ? db.purchaseOrder.findUnique({ where: { id: inst.bizId }, include: { supplier: { select: { name: true } } } })
      : Promise.resolve(null),
    inst.status === "APPROVED" && inst.flow.key === "expense"
      ? db.journalEntry.findFirst({ where: { sourceType: "expense", sourceId: inst.id }, select: { no: true } })
      : Promise.resolve(null),
  ]);
  const usersById = new Map(refUsers.map((u) => [u.id, u]));

  const flowSteps = parseSteps(inst.flow.steps);
  const maxStep = inst.tasks.reduce((m, t) => Math.max(m, t.step), -1);
  const nodeCount = Math.max(maxStep + 1, flowSteps.length);
  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const tasks = inst.tasks.filter((t) => t.step === i);
    let state: NodeState;
    if (tasks.some((t) => t.status === "REJECTED")) state = "rejected";
    else if (tasks.some((t) => t.status === "APPROVED")) state = "approved";
    else if (tasks.some((t) => t.status === "PENDING")) state = "pending";
    else if (!tasks.length && inst.status === "PENDING") state = "waiting";
    else state = "skipped";
    return { index: i, name: tasks[0]?.stepName ?? flowSteps[i]?.name ?? `节点 ${i + 1}`, tasks, state, preview: preview[i] };
  });

  const myTask = inst.status === "PENDING" ? inst.tasks.find((t) => t.approverId === user.id && t.status === "PENDING") : undefined;
  const isApplicant = inst.applicantId === user.id;
  const canResubmit = isApplicant && !inst.flow.system && inst.flow.enabled && (inst.status === "REJECTED" || inst.status === "WITHDRAWN");

  // 表单定义中没有、但数据里存在的字段（流程被修改过）也展示出来
  const extraKeys = Object.keys(data).filter((k) => !fields.some((f) => f.name === k));

  function renderValue(f: FormField) {
    const v = data[f.name];
    if (v === undefined || v === null || v === "") return <span className="text-ink-3">—</span>;
    if (f.type === "user") {
      const u = usersById.get(String(v));
      return u ? <UserChip name={u.name} color={u.avatarColor} /> : <span className="text-ink-3">（成员不存在）</span>;
    }
    if (f.type === "number") {
      const n = Number(v);
      return <span className="tabular-nums">{/金额|费用|预算|元/.test(f.label) ? formatMoney(n) : formatNumber(n, 2)}</span>;
    }
    if (f.type === "date") return formatDate(String(v));
    if (f.type === "textarea") return <span className="whitespace-pre-wrap">{String(v)}</span>;
    if (f.type === "select") return <Badge color="blue">{String(v)}</Badge>;
    return String(v);
  }

  const banner =
    inst.status === "APPROVED"
      ? { cls: "bg-tag-green/60 text-tag-green-ink", icon: <Check className="size-4" />, text: `审批已通过 · ${formatDateTime(inst.finishedAt)}` }
      : inst.status === "REJECTED"
        ? { cls: "bg-tag-red/60 text-tag-red-ink", icon: <X className="size-4" />, text: `审批已驳回 · ${formatDateTime(inst.finishedAt)}` }
        : inst.status === "WITHDRAWN"
          ? { cls: "bg-tag-gray/70 text-tag-gray-ink", icon: <Ban className="size-4" />, text: `申请人已撤回 · ${formatDateTime(inst.finishedAt)}` }
          : null;

  return (
    <>
      <NotificationsChanged changed={marked.count > 0} />
      <TopBar
        crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "审批中心", href: "/oa/approvals" }, { label: inst.no }]}
        actions={
          <>
            <ShareToChatButton refType="approval" refId={inst.id} title={inst.title} subtitle={`${inst.flow.name} · ${inst.no}`} />
            {isApplicant && inst.status === "PENDING" && <WithdrawButton instanceId={inst.id} />}
            {canResubmit && (
              <LinkButton href={`/oa/approvals/new?flow=${inst.flow.key}&from=${inst.id}`}>
                <RotateCcw className="size-3.5" />
                重新发起
              </LinkButton>
            )}
          </>
        }
      />
      <Page>
        <PageHeader
          icon={inst.flow.icon}
          title={inst.title}
          meta={
            <>
              <StatusBadge map={APPROVAL_STATUS} value={inst.status} />
              <span className="text-ink-2">
                {inst.flow.name} · <span className="font-mono text-xs">{inst.no}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-2">
                <UserChip name={inst.applicant.name} color={inst.applicant.avatarColor} />
                {inst.applicant.department?.name && <span className="text-ink-3">{inst.applicant.department.name}</span>}
              </span>
              <span className="text-ink-2" title={formatDateTime(inst.createdAt)}>
                提交于 {formatRelative(inst.createdAt)}
              </span>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {myTask && <DecisionBar instanceId={inst.id} stepName={myTask.stepName} />}
            {banner && (
              <div className={cn("flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium", banner.cls)}>
                {banner.icon}
                {banner.text}
              </div>
            )}

            <Section title="申请内容" className={myTask || banner ? "mt-6" : "mt-0"}>
              <Card className="px-4">
                <Properties>
                  {fields.map((f) => (
                    <Property key={f.name} label={f.label}>
                      {renderValue(f)}
                    </Property>
                  ))}
                  {extraKeys.map((k) => (
                    <Property key={k} label={k}>
                      {String(data[k] ?? "—")}
                    </Property>
                  ))}
                  {!fields.length && !extraKeys.length && !inst.bizType && (
                    <div className="py-2 text-sm text-ink-3">没有表单内容</div>
                  )}
                  {inst.bizType === "purchase_order" && inst.bizId && (
                    <Property label="关联单据">
                      <Link href={`/erp/purchase/${inst.bizId}`} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                        🛒 采购订单 {po?.no ?? ""}
                        <ExternalLink className="size-3" />
                      </Link>
                      {po && (
                        <span className="ml-2 text-[13px] text-ink-2">
                          {po.supplier.name} · {formatMoney(po.totalAmount)}
                        </span>
                      )}
                    </Property>
                  )}
                  {voucher && (
                    <Property label="记账凭证">
                      {can(user, "finance:view") ? (
                        <Link href="/finance/vouchers" className="inline-flex items-center gap-1.5 text-accent hover:underline">
                          🧾 {voucher.no}
                          <ExternalLink className="size-3" />
                        </Link>
                      ) : (
                        <span>🧾 {voucher.no}</span>
                      )}
                      <span className="ml-2 text-[13px] text-ink-3">审批通过后自动生成</span>
                    </Property>
                  )}
                </Properties>
              </Card>
            </Section>

            <Section title={`评论 ${comments.length || ""}`}>
              <ApprovalComments
                instanceId={inst.id}
                me={{ id: user.id, name: user.name, avatarColor: user.avatarColor }}
                canModerate={can(user, "admin")}
                comments={comments.map((c) => ({ id: c.id, content: c.content, createdAt: c.createdAt.toISOString(), author: c.author }))}
              />
            </Section>
          </div>

          <aside>
            <Card className="p-4">
              <h3 className="mb-4 text-[13px] font-semibold text-ink">审批进度</h3>
              <ol className="relative space-y-5 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-line">
                <li className="relative flex gap-3">
                  <span className="z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#448361] text-white">
                    <Send className="size-3" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium text-ink">发起申请</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <UserChip name={inst.applicant.name} color={inst.applicant.avatarColor} className="text-[13px]" />
                      <span className="text-xs text-ink-3">{formatDateTime(inst.createdAt)}</span>
                    </div>
                  </div>
                </li>
                {nodes.map((n) => {
                  const meta = NODE_META[n.state];
                  const acted = n.tasks.filter((t) => t.status !== "SKIPPED" || n.state === "skipped");
                  return (
                    <li key={n.index} className="relative flex gap-3">
                      <span className={cn("z-10 flex size-6 shrink-0 items-center justify-center rounded-full", meta.dot)}>
                        <NodeIcon state={n.state} />
                      </span>
                      <div className={cn("min-w-0 flex-1 text-sm", n.state === "pending" && "rounded-md bg-accent-soft/60 -m-1.5 p-1.5")}>
                        <div className="flex items-center gap-2">
                          <span className={cn("font-medium", n.state === "skipped" || n.state === "waiting" ? "text-ink-2" : "text-ink")}>{n.name}</span>
                          <Badge color={meta.color}>{meta.label}</Badge>
                          {n.tasks.length > 1 && <span className="text-xs text-ink-3">或签</span>}
                        </div>
                        <div className="mt-1.5 space-y-2">
                          {acted.map((t) => (
                            <div key={t.id}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                                  <Avatar name={t.approver.name} color={t.approver.avatarColor} size={18} />
                                  <span className="truncate">{t.approver.name}</span>
                                  {t.status !== "PENDING" && (
                                    <span
                                      className={cn(
                                        "text-xs",
                                        t.status === "APPROVED" ? "text-[#448361]" : t.status === "REJECTED" ? "text-danger" : "text-ink-3",
                                      )}
                                    >
                                      {APPROVAL_TASK_STATUS[t.status].label}
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 text-xs text-ink-3">{t.actedAt ? formatDateTime(t.actedAt) : ""}</span>
                              </div>
                              {t.comment && (
                                <div className="mt-1 rounded-md bg-sidebar px-2.5 py-1.5 text-[13px] text-ink-2 whitespace-pre-wrap">{t.comment}</div>
                              )}
                            </div>
                          ))}
                          {!n.tasks.length && n.preview && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
                              {n.preview.approvers.map((a) => (
                                <span key={a.id} className="inline-flex items-center gap-1">
                                  <Avatar name={a.name} color={a.avatarColor} size={18} />
                                  {a.name}
                                </span>
                              ))}
                              <span className="text-xs text-ink-3">{n.preview.detail}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
                <li className="relative flex gap-3">
                  <span
                    className={cn(
                      "z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
                      inst.status === "APPROVED"
                        ? "bg-[#448361] text-white"
                        : inst.status === "REJECTED"
                          ? "bg-[#d44c47] text-white"
                          : "bg-hover text-ink-3",
                    )}
                  >
                    <Flag className="size-3" />
                  </span>
                  <div className="text-sm">
                    <div className={cn("font-medium", inst.status === "PENDING" ? "text-ink-3" : "text-ink")}>
                      {inst.status === "PENDING" ? "结束" : APPROVAL_STATUS[inst.status].label}
                    </div>
                    {inst.finishedAt && <div className="text-xs text-ink-3">{formatDateTime(inst.finishedAt)}</div>}
                  </div>
                </li>
              </ol>
            </Card>
          </aside>
        </div>
      </Page>
    </>
  );
}
