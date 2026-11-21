import { Fragment } from "react";
import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";

/** 路线示意：起点 → 途经点 → 终点，按运输状态标出进度 */
export function RouteHeader({
  origin,
  destination,
  stops,
  status,
  trackingCount,
  latestLocation,
}: {
  origin: string;
  destination: string;
  stops: string[];
  status: string;
  trackingCount: number;
  latestLocation?: string | null;
}) {
  const points = [origin, ...stops, destination];
  const last = points.length - 1;
  const reached = status === "DELIVERED" ? last : status === "IN_TRANSIT" ? Math.min(last - 1, trackingCount) : 0;
  const moving = status === "IN_TRANSIT";
  const cancelled = status === "CANCELLED";
  return (
    <div className={cn("rounded-lg border border-line bg-gradient-to-b from-sidebar to-white px-5 pb-4 pt-5", cancelled && "opacity-60")}>
      <div className="flex items-start">
        {points.map((p, i) => {
          const done = !cancelled && i <= reached;
          const isEnd = i === 0 || i === last;
          return (
            <Fragment key={`${p}-${i}`}>
              <div className={cn("flex shrink-0 flex-col items-center", isEnd ? "w-28" : "w-20")}>
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full border-2",
                    isEnd ? "size-4" : "size-3 mt-0.5",
                    done ? "border-[#448361] bg-[#448361]" : "border-line-strong bg-white",
                  )}
                />
                <span className={cn("mt-2 text-center text-xs leading-snug", isEnd ? "font-medium text-ink" : "text-ink-2")}>{p}</span>
                <span className="mt-0.5 text-[11px] text-ink-3">{i === 0 ? "起点" : i === last ? "终点" : "途经"}</span>
              </div>
              {i < last && (
                <div className="relative mt-[7px] h-0.5 min-w-8 flex-1 rounded-full bg-line-strong">
                  {!cancelled && i < reached && <div className="absolute inset-0 rounded-full bg-[#448361]" />}
                  {!cancelled && moving && i === reached && (
                    <>
                      <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-[#448361]" />
                      <span className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#9065b0] text-white shadow-card">
                        <Truck className="size-4" />
                      </span>
                    </>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {moving && latestLocation && (
        <div className="mt-3 text-center text-xs text-ink-2">
          最新位置：<span className="font-medium text-ink">{latestLocation}</span>
        </div>
      )}
    </div>
  );
}
