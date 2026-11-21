import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { FlowDesigner } from "../flow-designer";
import { loadDesignerOptions } from "../load-options";

export default async function NewFlowPage() {
  const options = await loadDesignerOptions();
  return (
    <>
      <TopBar crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "流程管理", href: "/oa/flows" }, { label: "新建流程" }]} />
      <Page>
        <PageHeader icon="✨" title="新建审批流程" description="配置基本信息、表单字段与审批节点" />
        <FlowDesigner
          {...options}
          instanceCount={0}
          flow={{
            key: "",
            name: "",
            category: "通用",
            icon: "📝",
            description: "",
            system: false,
            formSchema: [
              { name: "content", label: "申请内容", type: "textarea", required: true },
            ],
            steps: [{ name: "直属主管审批", approverType: "manager" }],
          }}
        />
      </Page>
    </>
  );
}
