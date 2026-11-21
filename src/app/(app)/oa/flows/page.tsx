import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { parseFormSchema, parseSteps } from "@/lib/services/approval";
import { formatRelative } from "@/lib/format";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FlowToggle } from "./flow-toggle";

export default async function FlowsPage() {
  const flows = await db.approvalFlow.findMany({
    orderBy: [{ system: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { instances: true } } },
  });
  return (
    <>
      <TopBar
        crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "流程管理" }]}
        actions={
          <LinkButton href="/oa/flows/new" variant="primary">
            <Plus className="size-3.5" />
            新建流程
          </LinkButton>
        }
      />
      <Page wide>
        <PageHeader icon="🧭" title="流程管理" description="设计审批表单与审批节点；停用后将不再出现在「发起审批」中" />
        <Table>
          <THead>
            <TR>
              <TH>流程</TH>
              <TH>分类</TH>
              <TH>表单字段</TH>
              <TH>审批节点</TH>
              <TH className="text-right">审批单数</TH>
              <TH>更新时间</TH>
              <TH>启用</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {flows.map((f) => {
              const steps = parseSteps(f.steps);
              return (
                <TR key={f.id}>
                  <TD className="max-w-[320px]">
                    <Link href={`/oa/flows/${f.id}`} className="flex items-center gap-2.5 py-1">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-hover text-lg">{f.icon}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium hover:underline">
                          {f.name}
                          {f.system && <Badge color="purple">业务单据</Badge>}
                        </span>
                        <span className="block truncate text-xs text-ink-3">
                          <span className="font-mono">{f.key}</span>
                          {f.description ? ` · ${f.description}` : ""}
                        </span>
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <Badge>{f.category}</Badge>
                  </TD>
                  <TD className="tabular-nums text-ink-2">{f.system ? "—" : parseFormSchema(f.formSchema).length}</TD>
                  <TD>
                    <span className="flex flex-wrap items-center gap-1 text-[13px] text-ink-2">
                      {steps.map((s, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          {i > 0 && <ArrowRight className="size-3 text-ink-3" />}
                          {s.name}
                        </span>
                      ))}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{f._count.instances}</TD>
                  <TD className="whitespace-nowrap text-ink-2">{formatRelative(f.updatedAt)}</TD>
                  <TD>
                    <FlowToggle id={f.id} enabled={f.enabled} name={f.name} />
                  </TD>
                  <TD className="text-right">
                    <LinkButton href={`/oa/flows/${f.id}`} variant="ghost" size="xs">
                      编辑
                    </LinkButton>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Page>
    </>
  );
}
