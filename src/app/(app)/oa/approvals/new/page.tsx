import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Flag, Send } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { parseFormSchema, parseSteps } from "@/lib/services/approval";
import { parseFormData, toFormValues } from "@/lib/oa/form";
import { getMemberOptions, previewSteps } from "@/lib/oa/server";
import { Card, EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Avatar } from "@/components/ui/avatar";
import { NewApprovalForm } from "./new-approval-form";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function NewApprovalPage({ searchParams }: PageProps<"/oa/approvals/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const flowKey = str(sp.flow);

  if (!flowKey) {
    const flows = await db.approvalFlow.findMany({
      where: { system: false, enabled: true },
      orderBy: { createdAt: "asc" },
    });
    const groups = flows.reduce<Record<string, typeof flows>>((acc, f) => {
      (acc[f.category] ??= []).push(f);
      return acc;
    }, {});
    return (
      <>
        <TopBar crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "审批中心", href: "/oa/approvals" }, { label: "发起审批" }]} />
        <Page>
          <PageHeader icon="📮" title="发起审批" description="选择一个审批流程，填写表单后提交" />
          {flows.length === 0 && <EmptyState icon="🗂️" title="暂无可用的审批流程" description="请联系 OA 管理员在「流程管理」中启用流程" />}
          {Object.entries(groups).map(([category, list]) => (
            <section key={category} className="mb-8">
              <h2 className="mb-2 text-xs font-medium text-ink-3">{category}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((f) => (
                  <Link
                    key={f.id}
                    href={`/oa/approvals/new?flow=${f.key}`}
                    className="group flex items-start gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:bg-sidebar"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover text-2xl">{f.icon}</span>
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{f.name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2">{f.description || "—"}</span>
                      <span className="mt-1.5 block text-xs text-ink-3">
                        {parseFormSchema(f.formSchema).length} 个字段 · {parseSteps(f.steps).length} 个审批节点
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </Page>
      </>
    );
  }

  const flow = await db.approvalFlow.findUnique({ where: { key: flowKey } });
  if (!flow || flow.system) notFound();
  const fields = parseFormSchema(flow.formSchema);
  const [members, preview] = await Promise.all([getMemberOptions(), previewSteps(parseSteps(flow.steps), user.id)]);

  let initialValues = {};
  let defaultTitle = `${user.name}的${flow.name}`;
  const fromId = str(sp.from);
  if (fromId) {
    const src = await db.approvalInstance.findUnique({ where: { id: fromId } });
    if (src && src.applicantId === user.id && src.flowId === flow.id) {
      initialValues = toFormValues(parseFormData(src.formData));
      defaultTitle = src.title;
    }
  }

  return (
    <>
      <TopBar
        crumbs={[
          { label: "OA 办公", href: "/oa" },
          { label: "审批中心", href: "/oa/approvals" },
          { label: "发起审批", href: "/oa/approvals/new" },
          { label: flow.name },
        ]}
      />
      <Page>
        <Link href="/oa/approvals/new" className="mt-6 inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
          <ArrowLeft className="size-3.5" />
          选择其他流程
        </Link>
        <PageHeader icon={flow.icon} title={flow.name} description={flow.description || undefined} />
        {!flow.enabled ? (
          <EmptyState icon="⏸️" title="该流程已停用" description="请选择其他流程，或联系 OA 管理员启用" />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
            <NewApprovalForm
              flowKey={flow.key}
              fields={fields}
              members={members}
              defaultTitle={defaultTitle}
              initialValues={initialValues}
            />
            <aside>
              <Card className="p-4">
                <h3 className="mb-3 text-[13px] font-semibold text-ink">审批流程</h3>
                <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
                  <li className="relative flex gap-3">
                    <span className="z-10 flex size-6 items-center justify-center rounded-full bg-accent text-white">
                      <Send className="size-3" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <div className="font-medium text-ink">发起申请</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
                        <Avatar name={user.name} color={user.avatarColor} size={16} />
                        {user.name}
                      </div>
                    </div>
                  </li>
                  {preview.map((s, i) => (
                    <li key={i} className="relative flex gap-3">
                      <span className="z-10 flex size-6 items-center justify-center rounded-full border border-line-strong bg-white text-[11px] font-medium text-ink-2">
                        {i + 1}
                      </span>
                      <div className="min-w-0 text-sm">
                        <div className="font-medium text-ink">{s.name}</div>
                        <div className="text-xs text-ink-3">{s.detail}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {s.approvers.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1 text-xs text-ink-2">
                              <Avatar name={a.name} color={a.avatarColor} size={16} />
                              {a.name}
                            </span>
                          ))}
                        </div>
                        {s.fallback && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-[#cb912f]">
                            <AlertTriangle className="size-3" />
                            未找到审批人，将由系统管理员审批
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                  <li className="relative flex gap-3">
                    <span className="z-10 flex size-6 items-center justify-center rounded-full bg-hover text-ink-3">
                      <Flag className="size-3" />
                    </span>
                    <div className="text-sm text-ink-2">结束</div>
                  </li>
                </ol>
                {preview.length === 0 && <p className="mt-3 text-xs text-ink-3">该流程没有审批节点，提交后将自动通过。</p>}
              </Card>
            </aside>
          </div>
        )}
      </Page>
    </>
  );
}
