import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/dal";
import { ContextPanel } from "@/components/shell/context-panel";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { DocsTrashLink } from "@/components/docs/docs-trash-link";

export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const user = await requirePermission("docs:view");
  return (
    <div className="flex min-h-app">
      <ContextPanel title="云文档" footer={<DocsTrashLink />}>
        <Suspense fallback={<div className="px-2 py-1 text-xs text-ink-3">加载文档…</div>}>
          <DocsSidebar userId={user.id} />
        </Suspense>
      </ContextPanel>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
