import "server-only";
import { db } from "@/lib/db";
import { parseStops } from "@/lib/tms/stops";

/** 调度弹窗所需的车辆 / 司机 / 线路选项 */
export async function getDispatchOptions() {
  const [vehicles, drivers, routes, assigned] = await Promise.all([
    db.vehicle.findMany({ orderBy: { plateNo: "asc" } }),
    db.driver.findMany({ orderBy: { name: "asc" } }),
    db.route.findMany({ orderBy: { createdAt: "asc" } }),
    db.transportOrder.findMany({ where: { status: "ASSIGNED" }, select: { vehicleId: true, driverId: true } }),
  ]);
  const vehicleTasks = new Map<string, number>();
  const driverTasks = new Map<string, number>();
  for (const a of assigned) {
    if (a.vehicleId) vehicleTasks.set(a.vehicleId, (vehicleTasks.get(a.vehicleId) ?? 0) + 1);
    if (a.driverId) driverTasks.set(a.driverId, (driverTasks.get(a.driverId) ?? 0) + 1);
  }
  return {
    vehicles: vehicles.map((v) => ({
      id: v.id,
      plateNo: v.plateNo,
      type: v.type,
      capacity: v.capacity,
      status: v.status as string,
      assignedCount: vehicleTasks.get(v.id) ?? 0,
    })),
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      status: d.status as string,
      assignedCount: driverTasks.get(d.id) ?? 0,
    })),
    routes: routes.map((r) => ({
      id: r.id,
      name: r.name,
      origin: r.origin,
      destination: r.destination,
      distanceKm: r.distanceKm,
      estimatedHours: r.estimatedHours,
      stops: parseStops(r.stops),
    })),
  };
}

export type DispatchOptions = Awaited<ReturnType<typeof getDispatchOptions>>;

export async function getDriverByUser(userId: string) {
  return db.driver.findUnique({ where: { userId } });
}
