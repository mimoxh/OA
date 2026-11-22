import { requirePermission } from "@/lib/auth/dal";
import { queryGraphData } from "@/lib/docs/links";
import { TopBar } from "@/components/ui/page";
import { GraphView } from "@/components/docs/graph/graph-view";

export default async function DocsGraphPage({ searchParams }: PageProps<"/docs/graph">) {
  const user = await requirePermission("docs:view");
  const sp = await searchParams;
  const requestedSpace = typeof sp.space === "string" && sp.space.trim() ? sp.space.trim() : null;
  const requestedFocus = typeof sp.focus === "string" && sp.focus.trim() ? sp.focus.trim() : null;

  const data = await queryGraphData(user);
  const validSpace = requestedSpace && data.spaces.some((s) => s.id === requestedSpace) ? requestedSpace : null;
  const validFocus = requestedFocus && data.nodes.some((n) => n.id === requestedFocus) ? requestedFocus : null;
  const activeSpace = validSpace ? data.spaces.find((s) => s.id === validSpace) : null;

  const crumbs = activeSpace
    ? [
        { label: "文档", href: "/docs" },
        { label: `${activeSpace.icon} ${activeSpace.name}`, href: `/docs?space=${activeSpace.id}` },
        { label: "关系图" },
      ]
    : [{ label: "文档", href: "/docs" }, { label: "关系图" }];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar crumbs={crumbs} />
      <GraphView
        initialData={data}
        initialSpaceId={validSpace}
        initialFocusId={validFocus}
        initialLocal={!!validFocus}
        initialDepth={1}
      />
    </div>
  );
}
