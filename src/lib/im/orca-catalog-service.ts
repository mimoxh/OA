import os from "node:os";
import { db } from "@/lib/db";
import type { OrcaCatalog } from "./orca-catalog-shared";
import { localDiscoveryDisabled, readOrcaModelCatalog, resolveOrcaCatalogPath, runOrcaInstalled, type CatalogReadResult, type CliResult } from "./orca-catalog";
import { catalogToSnapshot, listCustomModels, loadSnapshots, resolveOrcaCatalog, saveSnapshot } from "./orca-catalog-sync";

/*
 * GET /api/im/webhooks/orca-catalog 的数据源：本机 Orca → 已同步快照 → 静态预设（见 resolveOrcaCatalog），并合并自定义模型。
 */

const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: OrcaCatalog } | null = null;
let inflight: Promise<OrcaCatalog> | null = null;

/** 同步 / 导入 / 自定义模型变更后调用，下次读取立即生效 */
export function invalidateOrcaCatalogCache() {
  cache = null;
}

/** OA 与 Orca 同机时，把本机真实目录记为该主机的快照（内容变化才写库） */
async function recordLocalSnapshot(catalog: OrcaCatalog) {
  const snap = catalogToSnapshot(catalog, os.hostname(), null);
  if (!snap) return;
  try {
    await saveSnapshot(db, snap, "local");
  } catch (e) {
    console.warn("[orca-catalog] 记录本机目录快照失败", e instanceof Error ? e.message : e);
  }
}

async function discover(): Promise<OrcaCatalog> {
  const disabled = localDiscoveryDisabled();
  const [cli, local, snapshots, customs] = await Promise.all([
    disabled ? Promise.resolve<CliResult>({ status: "disabled" }) : runOrcaInstalled(),
    disabled ? Promise.resolve<CatalogReadResult>({ status: "missing", agents: new Map() }) : readOrcaModelCatalog(resolveOrcaCatalogPath()),
    loadSnapshots(db).catch((e) => {
      console.warn("[orca-catalog] 读取同步快照失败", e instanceof Error ? e.message : e);
      return [];
    }),
    listCustomModels(db).catch(() => []),
  ]);
  if (cli.status === "error" && cli.error) console.warn(`[orca-catalog] CLI error: ${cli.error}`);
  if (local.status !== "ok" && local.status !== "missing") console.warn(`[orca-catalog] 模型目录 ${local.status}: ${local.error ?? ""}`);
  const value = resolveOrcaCatalog({ cli, local, snapshots, customs, localHost: os.hostname() });
  if (cli.status === "ok" && local.status === "ok") {
    // 用不含自定义模型的本机目录生成快照
    await recordLocalSnapshot(resolveOrcaCatalog({ cli, local, snapshots: [], customs: [] }));
  }
  return value;
}

/** 结果缓存 60 秒并合并并发请求，避免每次打开下拉都启动子进程；refresh 强制重新发现 */
export async function getOrcaCatalog({ refresh = false }: { refresh?: boolean } = {}): Promise<OrcaCatalog> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = discover()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
