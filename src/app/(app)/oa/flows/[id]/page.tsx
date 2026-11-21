import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseFormSchema, parseSteps } from "@/lib/services/approval";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { FlowDesigner } from "../flow-designer";
import { loadDesignerOptions } from "../load-options";

export default async function EditFlowPage({ params }: PageProps<"/oa/flows/[id]">) {
  const { id } = await params;
  const flow = await db.approvalFlow.findUnique({ where: { id }, include: { _count: { select: { instances: true } } } });
  if (!flow) notFound();
  const options = await loadDesignerOptions();
  return (
    <>
      <TopBar crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "流程管理", href: "/oa/flows" }, { label: flow.name }]} />
      <Page>
        <PageHeader
          icon={flow.icon}
          title={flow.name}
          description={flow.description || undefined}
          meta={
            <>
              {flow.system && <Badge color="purple">业务单据专用</Badge>}
              <Badge color={flow.enabled ? "green" : "gray"}>{flow.enabled ? "已启用" : "已停用"}</Badge>
              <span className="text-ink-2">已产生 {flow._count.instances} 条审批单</span>
            </>
          }
        />
        <FlowDesigner
          {...options}
          instanceCount={flow._count.instances}
          flow={{
            id: flow.id,
            key: flow.key,
            name: flow.name,
            category: flow.category,
            icon: flow.icon,
            description: flow.description ?? "",
            system: flow.system,
            formSchema: parseFormSchema(flow.formSchema),
            steps: parseSteps(flow.steps),
          }}
        />
      </Page>
    </>
  );
}
