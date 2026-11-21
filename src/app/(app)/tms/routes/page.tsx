import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatNumber } from "@/lib/format";
import { formatHours, parseStops } from "@/lib/tms/stops";
import { Button } from "@/components/ui/button";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { RouteDialog, RouteRowActions } from "@/components/tms/master-forms";

export default async function RoutesPage() {
  const user = await requireUser();
  const canEdit = can(user, "tms:edit");
  const routes = await db.route.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { orders: true } } } });

  return (
    <>
      <TopBar
        crumbs={[{ label: "TMS 运输", href: "/tms" }, { label: "线路" }]}
        actions={
          canEdit ? (
            <RouteDialog
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建线路
                </Button>
              }
            />
          ) : null
        }
      />
      <Page>
        <PageHeader icon="🗺️" title="线路" description="常用运输线路，调度时选择线路可带出预计时长与途经点" />
        {routes.length === 0 ? (
          <EmptyState title="还没有线路" description="新建线路后，调度时可以直接选择" />
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {routes.map((r) => {
              const stops = parseStops(r.stops);
              const points = [r.origin, ...stops, r.destination];
              return (
                <div key={r.id} className="group flex items-center gap-4 px-1 py-3 hover:bg-sidebar">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-medium text-ink">{r.name}</span>
                      <span className="text-xs text-ink-3">已用于 {r._count.orders} 张运输单</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-y-1 text-[13px]">
                      {points.map((p, i) => (
                        <span key={`${p}-${i}`} className="flex items-center">
                          <span
                            className={
                              i === 0 || i === points.length - 1
                                ? "rounded bg-tag-blue px-1.5 py-0.5 text-tag-blue-ink"
                                : "rounded bg-hover px-1.5 py-0.5 text-ink-2"
                            }
                          >
                            {p}
                          </span>
                          {i < points.length - 1 && <span className="mx-1.5 text-ink-3">→</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="w-24 text-right">
                    <div className="text-xs text-ink-3">里程</div>
                    <div className="tabular-nums">{formatNumber(r.distanceKm)} km</div>
                  </div>
                  <div className="w-28 text-right">
                    <div className="text-xs text-ink-3">预计时长</div>
                    <div className="tabular-nums">{formatHours(r.estimatedHours)}</div>
                  </div>
                  {canEdit && (
                    <div className="w-16">
                      <RouteRowActions
                        route={{
                          id: r.id,
                          name: r.name,
                          origin: r.origin,
                          destination: r.destination,
                          distanceKm: r.distanceKm,
                          estimatedHours: r.estimatedHours,
                          stops,
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Page>
    </>
  );
}
