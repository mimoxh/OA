import "server-only";
import { db } from "@/lib/db";
import { getDocAccess, getSpaceAccess, visibleSpaceWhere, type DocUser } from "@/lib/docs/access";
import { extractText, parseContent } from "@/lib/docs/content";
import { getMentionableUsers } from "@/lib/docs/queries";
import { dateCellRange, localDay } from "./date-cells";
import {
  applyRowPatch,
  cellText,
  cellValue,
  defaultDatabaseSchema,
  makeId,
  rowSearchText,
  validateDatabaseSchema,
  validatePropertyValue,
} from "./engine";
import { coerceComputedResult, evaluateFormula, extractFormulaDependencies, type FormulaValue } from "./formula";
import { diffDatabaseSchemas, planSchemaRestore } from "./history";
import {
  DATABASE_LIMITS,
  effectiveType,
  type DatabasePayload,
  type DatabaseRow,
  type DatabaseView,
  type PersonOption,
  type PropertyDefinition,
  type PropertyValue,
  type RelationCell,
  type RollupFunction,
  type RowProperties,
  type SchemaHistoryDetail,
  type SchemaHistorySummary,
  type TargetDatabaseSummary,
} from "./types";

const NEW_ROW_CONTENT = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

export class DatabaseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parseSchemaJson(rawProps: string, rawViews: string): {
  properties: PropertyDefinition[];
  views: DatabaseView[];
} {
  try {
    const properties = JSON.parse(rawProps);
    const views = JSON.parse(rawViews);
    return {
      properties: Array.isArray(properties) ? (properties as PropertyDefinition[]) : [],
      views: Array.isArray(views) ? (views as DatabaseView[]) : [],
    };
  } catch {
    return defaultDatabaseSchema();
  }
}

export function parseRowPropsJson(raw: string): RowProperties {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RowProperties) : {};
  } catch {
    return {};
  }
}

async function requireDatabaseAccess(user: DocUser, databaseId: string, needWrite: boolean) {
  const r = await getDocAccess(user, databaseId);
  if (!r || !r.access.canView || r.doc.deletedAt || r.doc.kind !== "database") {
    throw new DatabaseError(404, "多维表格不存在或没有访问权限");
  }
  if (needWrite && !r.access.canEdit) {
    throw new DatabaseError(403, "没有编辑该多维表格的权限");
  }
  const schemaRow = await db.databaseSchema.findUnique({ where: { documentId: databaseId } });
  if (!schemaRow) {
    throw new DatabaseError(404, "多维表格结构不存在");
  }
  const parsed = parseSchemaJson(schemaRow.properties, schemaRow.views);
  return {
    doc: r.doc,
    access: r.access,
    revision: schemaRow.revision,
    properties: parsed.properties,
    views: parsed.views,
  };
}

/**
 * Cross-database dependency graph checker for formulas & rollups.
 * Enforces acyclic dependencies and max depth <= DATABASE_LIMITS.formulaDepth (10).
 */
async function checkCrossDbComputedDependencies(
  databaseId: string,
  databaseTitle: string,
  candidateProperties: readonly PropertyDefinition[],
): Promise<void> {
  const schemaCache = new Map<string, { title: string; properties: PropertyDefinition[] }>();
  schemaCache.set(databaseId, { title: databaseTitle || "当前表格", properties: [...candidateProperties] });

  const loadSchema = async (dbId: string) => {
    const cached = schemaCache.get(dbId);
    if (cached) return cached;
    const row = await db.document.findFirst({
      where: { id: dbId, kind: "database", deletedAt: null },
      select: { title: true, databaseSchema: { select: { properties: true, views: true } } },
    });
    if (!row?.databaseSchema) return null;
    const parsed = parseSchemaJson(row.databaseSchema.properties, row.databaseSchema.views);
    const entry = { title: row.title || "未命名表格", properties: parsed.properties };
    schemaCache.set(dbId, entry);
    return entry;
  };

  type NodeKey = string; // `${dbId}:${propId}`
  const visited = new Set<NodeKey>();
  const visiting = new Set<NodeKey>();

  const dfs = async (
    curDbId: string,
    propId: string,
    stack: { key: NodeKey; label: string }[],
  ): Promise<void> => {
    const key: NodeKey = `${curDbId}:${propId}`;
    const schema = await loadSchema(curDbId);
    if (!schema) return;
    const def = schema.properties.find((p) => p.id === propId);
    if (!def || def.deletedAt) return;
    const label = `${schema.title}.${def.name}`;

    if (visiting.has(key)) {
      const idx = stack.findIndex((s) => s.key === key);
      const path = [...stack.slice(Math.max(0, idx)).map((s) => s.label), label];
      throw new DatabaseError(
        422,
        `计算字段存在循环依赖：${path.join(" → ")}`,
        "DATABASE_FORMULA_CYCLE",
        { path },
      );
    }
    if (stack.length >= DATABASE_LIMITS.formulaDepth) {
      const path = [...stack.map((s) => s.label), label];
      throw new DatabaseError(
        422,
        `公式/汇总依赖链深度超过上限（${DATABASE_LIMITS.formulaDepth} 层）`,
        "DATABASE_FORMULA_DEPTH",
        { path },
      );
    }
    if (visited.has(key)) return;

    visiting.add(key);
    const nextStack = [...stack, { key, label }];

    if (def.type === "formula" && def.formula) {
      const deps = extractFormulaDependencies(def.formula.expression);
      for (const depId of deps) {
        await dfs(curDbId, depId, nextStack);
      }
    } else if (def.type === "rollup" && def.rollup) {
      const rel = schema.properties.find((p) => p.id === def.rollup!.relationPropertyId && !p.deletedAt);
      if (rel?.type === "relation" && rel.relation?.databaseId) {
        await dfs(rel.relation.databaseId, def.rollup.targetPropertyId, nextStack);
      }
    }

    visiting.delete(key);
    visited.add(key);
  };

  for (const p of candidateProperties) {
    if (!p.deletedAt && (p.type === "formula" || p.type === "rollup")) {
      await dfs(databaseId, p.id, []);
    }
  }
}

interface LoadedDbBundle {
  id: string;
  title: string;
  icon: string | null;
  properties: PropertyDefinition[];
  views: DatabaseView[];
  rows: DatabaseRow[];
  rowsById: Map<string, DatabaseRow>;
  membersById: Map<string, PersonOption>;
  /** relationPropertyId -> rowId -> linked target row IDs */
  linksByProp: Map<string, Map<string, string[]>>;
}

function evalRollup(
  fn: RollupFunction,
  targetDef: PropertyDefinition | undefined,
  linkedRows: DatabaseRow[],
  targetMembersById: ReadonlyMap<string, PersonOption>,
): FormulaValue {
  if (fn === "count") return linkedRows.length;
  if (!targetDef) return null;

  const eff = effectiveType(targetDef);
  const rawVals = linkedRows
    .map((r) => cellValue(r, targetDef))
    .filter((v): v is PropertyValue => {
      if (v === undefined || v === "") return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });

  if (fn === "count_values") return rawVals.length;

  if (eff === "number") {
    const nums = rawVals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length === 0) return null;
    if (fn === "sum") return nums.reduce((a, b) => a + b, 0);
    if (fn === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (fn === "min") return Math.min(...nums);
    if (fn === "max") return Math.max(...nums);
  }

  if (eff === "date" || eff === "created_time" || eff === "updated_time") {
    const days = rawVals
      .map((v) =>
        eff === "created_time" || eff === "updated_time"
          ? localDay(new Date(String(v)))
          : (dateCellRange(v)?.start ?? null),
      )
      .filter((d): d is string => !!d)
      .sort();
    if (days.length === 0) return null;
    if (fn === "min") return days[0];
    if (fn === "max") return days[days.length - 1];
  }

  // Fallback for text min/max
  const texts = linkedRows
    .map((r) => cellText(r, targetDef, targetMembersById))
    .filter((s) => s !== "")
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (texts.length === 0) return null;
  if (fn === "min") return texts[0];
  if (fn === "max") return texts[texts.length - 1];
  return null;
}

/**
 * Loads a database bundle and synchronously computes relations, rollups, and formulas
 * across linked databases accessible to `user`, with memoization and runtime cycle protection.
 */
async function loadAndComputeBundle(
  user: DocUser,
  rootDbId: string,
  includeRows = true,
): Promise<{
  root: LoadedDbBundle;
  members: PersonOption[];
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  doc: NonNullable<Awaited<ReturnType<typeof getDocAccess>>>["doc"];
  access: NonNullable<Awaited<ReturnType<typeof getDocAccess>>>["access"];
  revision: number;
}> {
  const rootMeta = await requireDatabaseAccess(user, rootDbId, false);
  const rootMembers = await getMentionableUsers(rootMeta.doc.space);
  const bundles = new Map<string, LoadedDbBundle>();
  const deniedDbs = new Set<string>();

  const loadBundle = async (dbId: string, withRows: boolean): Promise<LoadedDbBundle | null> => {
    if (bundles.has(dbId)) return bundles.get(dbId)!;
    if (deniedDbs.has(dbId)) return null;

    let docInfo = dbId === rootDbId ? rootMeta.doc : null;
    let properties: PropertyDefinition[];
    let views: DatabaseView[];
    let members: PersonOption[];

    if (dbId === rootDbId) {
      properties = rootMeta.properties;
      views = rootMeta.views;
      members = rootMembers;
    } else {
      const r = await getDocAccess(user, dbId);
      if (!r || !r.access.canView || r.doc.deletedAt || r.doc.kind !== "database") {
        deniedDbs.add(dbId);
        return null;
      }
      const sr = await db.databaseSchema.findUnique({ where: { documentId: dbId } });
      if (!sr) {
        deniedDbs.add(dbId);
        return null;
      }
      docInfo = r.doc;
      const parsed = parseSchemaJson(sr.properties, sr.views);
      properties = parsed.properties;
      views = parsed.views;
      members = await getMentionableUsers(r.doc.space);
    }

    const rawRows = withRows
      ? await db.document.findMany({
          where: { parentId: dbId, kind: "row", deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            icon: true,
            cover: true,
            sortOrder: true,
            properties: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : [];

    const rows: DatabaseRow[] = rawRows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      cover: r.cover,
      sortOrder: r.sortOrder,
      properties: parseRowPropsJson(r.properties),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      relations: {},
      computed: {},
    }));

    const rowsById = new Map(rows.map((r) => [r.id, r]));
    const linksByProp = new Map<string, Map<string, string[]>>();

    if (withRows) {
      const activeRelations = properties.filter((p) => !p.deletedAt && p.type === "relation" && p.relation);
      if (activeRelations.length > 0 && rows.length > 0) {
        const [outLinks, inLinks] = await Promise.all([
          db.databaseRowLink.findMany({
            where: { sourceDatabaseId: dbId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          }),
          db.databaseRowLink.findMany({
            where: { targetDatabaseId: dbId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          }),
        ]);

        for (const rel of activeRelations) {
          const cfg = rel.relation!;
          const map = new Map<string, string[]>();
          if (cfg.owner) {
            for (const l of outLinks) {
              if (l.propertyId !== rel.id || !rowsById.has(l.sourceRowId)) continue;
              const arr = map.get(l.sourceRowId) ?? [];
              arr.push(l.targetRowId);
              map.set(l.sourceRowId, arr);
            }
          } else {
            for (const l of inLinks) {
              if (l.propertyId !== cfg.pairedPropertyId || !rowsById.has(l.targetRowId)) continue;
              const arr = map.get(l.targetRowId) ?? [];
              arr.push(l.sourceRowId);
              map.set(l.targetRowId, arr);
            }
          }
          linksByProp.set(rel.id, map);
        }
      }
    }

    const bundle: LoadedDbBundle = {
      id: dbId,
      title: docInfo!.title,
      icon: docInfo!.icon,
      properties,
      views,
      rows,
      rowsById,
      membersById: new Map(members.map((m) => [m.id, m])),
      linksByProp,
    };
    bundles.set(dbId, bundle);
    return bundle;
  };

  const root = (await loadBundle(rootDbId, includeRows))!;

  // Eagerly load referenced target databases for root's relation properties (and any chained rollups)
  const queue: { dbId: string; depth: number }[] = [{ dbId: rootDbId, depth: 0 }];
  const expanded = new Set<string>();
  while (queue.length > 0) {
    const { dbId, depth } = queue.shift()!;
    if (expanded.has(dbId) || depth > DATABASE_LIMITS.formulaDepth) continue;
    expanded.add(dbId);
    const b = await loadBundle(dbId, true);
    if (!b) continue;
    for (const p of b.properties) {
      if (!p.deletedAt && p.type === "relation" && p.relation?.databaseId) {
        const targetId = p.relation.databaseId;
        if (!expanded.has(targetId)) {
          queue.push({ dbId: targetId, depth: depth + 1 });
        }
      }
    }
  }

  // Populate RelationCell previews on every loaded bundle
  for (const bundle of bundles.values()) {
    for (const rel of bundle.properties) {
      if (rel.deletedAt || rel.type !== "relation" || !rel.relation) continue;
      const targetBundle = bundles.get(rel.relation.databaseId);
      const map = bundle.linksByProp.get(rel.id);
      if (!map) continue;
      for (const row of bundle.rows) {
        const ids = map.get(row.id) ?? [];
        const items: { id: string; title: string; icon: string | null }[] = [];
        for (const tid of ids) {
          const targetRow = targetBundle?.rowsById.get(tid);
          if (targetRow) {
            items.push({ id: targetRow.id, title: targetRow.title, icon: targetRow.icon });
          }
        }
        const cell: RelationCell = { items, total: items.length };
        row.relations![rel.id] = cell;
      }
    }
  }

  // Memoized recursive evaluator for formula & rollup cells across all loaded bundles
  const computedCache = new Map<string, string | number | boolean | undefined>();
  const activeEval = new Set<string>();
  const now = new Date();

  const evalCell = (dbId: string, rowId: string, propId: string): string | number | boolean | undefined => {
    const cacheKey = `${dbId}:${rowId}:${propId}`;
    if (computedCache.has(cacheKey)) return computedCache.get(cacheKey);
    if (activeEval.has(cacheKey)) return undefined;

    const bundle = bundles.get(dbId);
    if (!bundle) return undefined;
    const row = bundle.rowsById.get(rowId);
    if (!row) return undefined;
    const def = bundle.properties.find((p) => p.id === propId && !p.deletedAt);
    if (!def) return undefined;

    if (def.type !== "formula" && def.type !== "rollup") {
      if (def.type === "relation") {
        const txt = cellText(row, def, bundle.membersById);
        return txt === "" ? undefined : txt;
      }
      if (def.type === "select" || def.type === "multi_select" || def.type === "person") {
        const txt = cellText(row, def, bundle.membersById);
        return txt === "" ? undefined : txt;
      }
      const v = cellValue(row, def);
      if (Array.isArray(v)) return v.join(", ");
      return v;
    }

    activeEval.add(cacheKey);
    let result: string | number | boolean | undefined;

    if (def.type === "rollup" && def.rollup) {
      const relProp = bundle.properties.find((p) => p.id === def.rollup!.relationPropertyId && !p.deletedAt);
      if (relProp?.type === "relation" && relProp.relation) {
        const targetDbId = relProp.relation.databaseId;
        const targetBundle = bundles.get(targetDbId);
        const linkedIds = bundle.linksByProp.get(relProp.id)?.get(row.id) ?? [];
        if (targetBundle) {
          const targetDef = targetBundle.properties.find((p) => p.id === def.rollup!.targetPropertyId && !p.deletedAt);
          const linkedRows = linkedIds
            .map((tid) => targetBundle.rowsById.get(tid))
            .filter((x): x is DatabaseRow => !!x);
          // Ensure target computed property is evaluated on each linked row first
          if (targetDef && (targetDef.type === "formula" || targetDef.type === "rollup")) {
            for (const lr of linkedRows) {
              const cv = evalCell(targetDbId, lr.id, targetDef.id);
              if (cv !== undefined) lr.computed![targetDef.id] = cv;
            }
          }
          const raw = evalRollup(def.rollup.fn, targetDef, linkedRows, targetBundle.membersById);
          result = coerceComputedResult(raw, def.rollup.resultType);
        }
      }
    } else if (def.type === "formula" && def.formula) {
      const byName = new Map(bundle.properties.filter((p) => !p.deletedAt).map((p) => [p.name, p.id]));
      const byId = new Set(bundle.properties.filter((p) => !p.deletedAt).map((p) => p.id));
      result = evaluateFormula(def.formula.expression, def.formula.resultType, {
        now,
        getProperty: (idOrName: string): FormulaValue => {
          const targetPropId = byId.has(idOrName) ? idOrName : byName.get(idOrName);
          if (!targetPropId) return null;
          const v = evalCell(dbId, rowId, targetPropId);
          return v === undefined ? null : v;
        },
      });
    }

    activeEval.delete(cacheKey);
    computedCache.set(cacheKey, result);
    if (result !== undefined) {
      row.computed![propId] = result;
    }
    return result;
  };

  // Compute all formula & rollup properties on the root database
  const rootComputedProps = root.properties.filter((p) => !p.deletedAt && (p.type === "formula" || p.type === "rollup"));
  if (includeRows && rootComputedProps.length > 0) {
    for (const row of root.rows) {
      for (const prop of rootComputedProps) {
        evalCell(rootDbId, row.id, prop.id);
      }
    }
  }

  // Build relatedDatabases metadata map for relation pickers & rollup editors
  const relatedDatabases: Record<string, TargetDatabaseSummary> = {};
  for (const p of root.properties) {
    if (!p.deletedAt && p.type === "relation" && p.relation?.databaseId) {
      const target = bundles.get(p.relation.databaseId);
      if (target && !relatedDatabases[target.id]) {
        relatedDatabases[target.id] = {
          id: target.id,
          title: target.title,
          icon: target.icon,
          properties: target.properties,
          rows: target.rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon })),
        };
      }
    }
  }

  return {
    root,
    members: rootMembers,
    relatedDatabases,
    doc: rootMeta.doc,
    access: rootMeta.access,
    revision: rootMeta.revision,
  };
}

export async function getDatabasePayload(
  user: DocUser,
  databaseId: string,
  opts: { includeRows?: boolean } = {},
): Promise<DatabasePayload> {
  const { root, members, relatedDatabases, doc, access, revision } = await loadAndComputeBundle(
    user,
    databaseId,
    opts.includeRows !== false,
  );
  return {
    id: doc.id,
    spaceId: doc.spaceId,
    spaceName: doc.space.name,
    spaceIcon: doc.space.icon,
    parentId: doc.parentId,
    title: doc.title,
    icon: doc.icon,
    revision,
    properties: root.properties,
    views: root.views,
    rows: root.rows,
    members,
    canWrite: access.canEdit,
    relatedDatabases,
  };
}

export async function getRowDatabaseContext(user: DocUser, rowDocId: string, parentDbId: string) {
  try {
    const payload = await getDatabasePayload(user, parentDbId, { includeRows: true });
    const row = payload.rows.find((r) => r.id === rowDocId);
    if (!row) return null;
    return {
      databaseId: payload.id,
      databaseTitle: payload.title,
      databaseIcon: payload.icon,
      properties: payload.properties,
      row,
      members: payload.members,
      relatedDatabases: payload.relatedDatabases,
      canWrite: payload.canWrite,
    };
  } catch {
    return null;
  }
}

export async function listAccessibleDatabases(user: DocUser, spaceId?: string | null) {
  const spaces = await db.space.findMany({
    where: {
      ...visibleSpaceWhere(user),
      ...(spaceId ? { id: spaceId } : {}),
    },
    select: { id: true, name: true, icon: true },
  });
  const spaceIds = spaces.map((s) => s.id);
  if (spaceIds.length === 0) return [];
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));

  const dbs = await db.document.findMany({
    where: { spaceId: { in: spaceIds }, kind: "database", deletedAt: null, isTemplate: false },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      icon: true,
      spaceId: true,
      databaseSchema: { select: { views: true } },
    },
  });

  return dbs.map((d) => {
    let views: { id: string; name: string; type: string }[] = [];
    if (d.databaseSchema) {
      try {
        const parsed = JSON.parse(d.databaseSchema.views) as DatabaseView[];
        views = parsed.map((v) => ({ id: v.id, name: v.name, type: v.type }));
      } catch {}
    }
    const sp = spaceMap.get(d.spaceId);
    return {
      id: d.id,
      title: d.title || "未命名表格",
      icon: d.icon,
      spaceId: d.spaceId,
      spaceName: sp?.name ?? "",
      views,
    };
  });
}

export async function createDatabaseRecord(
  user: DocUser,
  input: { spaceId: string; parentId?: string | null; title?: string; icon?: string | null },
) {
  const sp = await getSpaceAccess(user, input.spaceId);
  if (!sp || !sp.access.canView) throw new DatabaseError(404, "空间不存在或没有访问权限");
  if (!sp.access.canEdit) throw new DatabaseError(403, "没有在该空间中新建多维表格的权限");

  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await db.document.findUnique({
      where: { id: parentId },
      select: { spaceId: true, deletedAt: true, kind: true },
    });
    if (!parent || parent.spaceId !== input.spaceId || parent.deletedAt) {
      throw new DatabaseError(404, "父页面不存在");
    }
    if (parent.kind !== "page") {
      throw new DatabaseError(400, "只能在普通页面下或空间根目录新建多维表格");
    }
  }

  const last = await db.document.findFirst({
    where: { spaceId: input.spaceId, parentId, deletedAt: null, isTemplate: false, kind: { not: "row" } },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const initial = defaultDatabaseSchema();
  const propsJson = JSON.stringify(initial.properties);
  const viewsJson = JSON.stringify(initial.views);
  const title = (input.title ?? "").trim() || "未命名多维表格";
  const icon = input.icon ?? "🗃️";

  const created = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        spaceId: input.spaceId,
        parentId,
        kind: "database",
        title,
        icon,
        fullWidth: true,
        content: NEW_ROW_CONTENT,
        text: "",
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await tx.databaseSchema.create({
      data: {
        documentId: doc.id,
        properties: propsJson,
        views: viewsJson,
        revision: 1,
      },
    });
    await tx.databaseSchemaVersion.create({
      data: {
        databaseId: doc.id,
        revision: 1,
        properties: propsJson,
        views: viewsJson,
        kind: "create",
        actorId: user.id,
      },
    });
    return doc;
  });

  return {
    id: created.id,
    title: created.title,
    icon: created.icon,
    defaultViewId: initial.views[0]?.id ?? null,
  };
}

async function recomputeRowsSearchText(
  databaseId: string,
  properties: readonly PropertyDefinition[],
  membersById: ReadonlyMap<string, PersonOption>,
) {
  const rows = await db.document.findMany({
    where: { parentId: databaseId, kind: "row", deletedAt: null },
    select: { id: true, content: true, properties: true },
  });
  for (const r of rows) {
    const bodyText = extractText(parseContent(r.content));
    const propText = rowSearchText(properties, parseRowPropsJson(r.properties), membersById);
    const merged = [bodyText, propText].filter(Boolean).join("\n");
    await db.document.update({ where: { id: r.id }, data: { text: merged } });
  }
}

export async function saveDatabaseSchema(
  user: DocUser,
  databaseId: string,
  input: {
    properties: PropertyDefinition[];
    views: DatabaseView[];
    expectedRevision?: number;
    kind?: "update" | "restore";
    sourceRevision?: number | null;
  },
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  if (input.expectedRevision !== undefined && input.expectedRevision !== meta.revision) {
    throw new DatabaseError(409, "多维表格结构已被其他人更新，请刷新后重试", "REVISION_CONFLICT", {
      currentRevision: meta.revision,
    });
  }

  const problem = validateDatabaseSchema(input.properties, input.views, meta.properties);
  if (problem) throw new DatabaseError(422, problem, "SCHEMA_INVALID");

  // Preserve server-owned relation configs so clients can't corrupt pairings
  const prevById = new Map(meta.properties.map((p) => [p.id, p]));
  const normalizedProps = input.properties.map((p) => {
    const prev = prevById.get(p.id);
    if (prev?.type === "relation") {
      return {
        ...prev,
        name: p.name.trim(),
        deletedAt: p.deletedAt ?? null,
      };
    }
    return { ...p, name: p.name.trim() };
  });

  await checkCrossDbComputedDependencies(databaseId, meta.doc.title, normalizedProps);

  const nextRevision = meta.revision + 1;
  const propsJson = JSON.stringify(normalizedProps);
  const viewsJson = JSON.stringify(input.views);

  await db.$transaction(async (tx) => {
    const updated = await tx.databaseSchema.updateMany({
      where: { documentId: databaseId, revision: meta.revision },
      data: { properties: propsJson, views: viewsJson, revision: nextRevision },
    });
    if (updated.count === 0) {
      throw new DatabaseError(409, "多维表格结构已被其他人更新，请刷新后重试", "REVISION_CONFLICT");
    }
    await tx.databaseSchemaVersion.create({
      data: {
        databaseId,
        revision: nextRevision,
        properties: propsJson,
        views: viewsJson,
        kind: input.kind ?? "update",
        sourceRevision: input.sourceRevision ?? null,
        actorId: user.id,
      },
    });
    await tx.document.update({
      where: { id: databaseId },
      data: { updatedById: user.id },
    });
  });

  const members = await getMentionableUsers(meta.doc.space);
  await recomputeRowsSearchText(databaseId, normalizedProps, new Map(members.map((m) => [m.id, m])));

  return { revision: nextRevision, properties: normalizedProps, views: input.views };
}

export async function createRelationPair(
  user: DocUser,
  sourceDatabaseId: string,
  input: { targetDatabaseId: string; name: string; pairedName?: string },
) {
  const source = await requireDatabaseAccess(user, sourceDatabaseId, true);
  const target =
    input.targetDatabaseId === sourceDatabaseId
      ? source
      : await requireDatabaseAccess(user, input.targetDatabaseId, true);

  const name = input.name.trim();
  const pairedName = (input.pairedName ?? "").trim() || source.doc.title || "关联记录";
  if (!name || name.length > DATABASE_LIMITS.name) {
    throw new DatabaseError(422, "关联字段名称不能为空");
  }
  if (source.properties.length >= DATABASE_LIMITS.properties) {
    throw new DatabaseError(422, `当前表格字段数量已达上限（${DATABASE_LIMITS.properties}）`);
  }
  if (target.doc.id !== source.doc.id && target.properties.length >= DATABASE_LIMITS.properties) {
    throw new DatabaseError(422, `目标表格字段数量已达上限（${DATABASE_LIMITS.properties}）`);
  }

  const ownerPropId = makeId("prop");
  const inversePropId = makeId("prop");

  const ownerProp: PropertyDefinition = {
    id: ownerPropId,
    name,
    type: "relation",
    relation: {
      databaseId: target.doc.id,
      pairedPropertyId: inversePropId,
      owner: true,
    },
  };
  const inverseProp: PropertyDefinition = {
    id: inversePropId,
    name: pairedName,
    type: "relation",
    relation: {
      databaseId: source.doc.id,
      pairedPropertyId: ownerPropId,
      owner: false,
    },
  };

  await db.$transaction(async (tx) => {
    if (source.doc.id === target.doc.id) {
      const nextProps = [...source.properties, ownerProp, inverseProp];
      const nextViews = source.views.map((v) => ({
        ...v,
        propertyOrder: [...v.propertyOrder, ownerPropId, inversePropId],
      }));
      const nextRev = source.revision + 1;
      const pj = JSON.stringify(nextProps);
      const vj = JSON.stringify(nextViews);
      await tx.databaseSchema.update({
        where: { documentId: source.doc.id },
        data: { properties: pj, views: vj, revision: nextRev },
      });
      await tx.databaseSchemaVersion.create({
        data: { databaseId: source.doc.id, revision: nextRev, properties: pj, views: vj, kind: "relation", actorId: user.id },
      });
    } else {
      const srcProps = [...source.properties, ownerProp];
      const srcViews = source.views.map((v) => ({ ...v, propertyOrder: [...v.propertyOrder, ownerPropId] }));
      const srcRev = source.revision + 1;
      const srcPj = JSON.stringify(srcProps);
      const srcVj = JSON.stringify(srcViews);
      await tx.databaseSchema.update({
        where: { documentId: source.doc.id },
        data: { properties: srcPj, views: srcVj, revision: srcRev },
      });
      await tx.databaseSchemaVersion.create({
        data: { databaseId: source.doc.id, revision: srcRev, properties: srcPj, views: srcVj, kind: "relation", actorId: user.id },
      });

      const tgtProps = [...target.properties, inverseProp];
      const tgtViews = target.views.map((v) => ({ ...v, propertyOrder: [...v.propertyOrder, inversePropId] }));
      const tgtRev = target.revision + 1;
      const tgtPj = JSON.stringify(tgtProps);
      const tgtVj = JSON.stringify(tgtViews);
      await tx.databaseSchema.update({
        where: { documentId: target.doc.id },
        data: { properties: tgtPj, views: tgtVj, revision: tgtRev },
      });
      await tx.databaseSchemaVersion.create({
        data: { databaseId: target.doc.id, revision: tgtRev, properties: tgtPj, views: tgtVj, kind: "relation", actorId: user.id },
      });
    }
  });

  return { ownerProperty: ownerProp, inverseProperty: inverseProp };
}

export async function changeRowRelations(
  user: DocUser,
  databaseId: string,
  rowId: string,
  propertyId: string,
  input: { add?: string[]; remove?: string[] },
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  const prop = meta.properties.find((p) => p.id === propertyId && !p.deletedAt);
  if (!prop || prop.type !== "relation" || !prop.relation) {
    throw new DatabaseError(404, "关联字段不存在");
  }

  const row = await db.document.findFirst({
    where: { id: rowId, parentId: databaseId, kind: "row", deletedAt: null },
    select: { id: true },
  });
  if (!row) throw new DatabaseError(404, "记录不存在");

  const targetDbId = prop.relation.databaseId;
  // User must at least be able to view target database to link rows
  await requireDatabaseAccess(user, targetDbId, false);

  const addIds = [...new Set((input.add ?? []).filter((x) => typeof x === "string" && x))];
  const removeIds = [...new Set((input.remove ?? []).filter((x) => typeof x === "string" && x))];

  if (addIds.length > 0) {
    const validTargets = await db.document.findMany({
      where: { id: { in: addIds }, parentId: targetDbId, kind: "row", deletedAt: null },
      select: { id: true },
    });
    const validSet = new Set(validTargets.map((t) => t.id));
    if (validSet.size !== addIds.length) {
      throw new DatabaseError(422, "部分关联的目标记录不存在或已删除");
    }
  }

  const ownerPropId = prop.relation.owner ? prop.id : prop.relation.pairedPropertyId;
  const srcDbId = prop.relation.owner ? databaseId : targetDbId;
  const tgtDbId = prop.relation.owner ? targetDbId : databaseId;

  await db.$transaction(async (tx) => {
    if (removeIds.length > 0) {
      if (prop.relation!.owner) {
        await tx.databaseRowLink.deleteMany({
          where: { propertyId: ownerPropId, sourceRowId: rowId, targetRowId: { in: removeIds } },
        });
      } else {
        await tx.databaseRowLink.deleteMany({
          where: { propertyId: ownerPropId, targetRowId: rowId, sourceRowId: { in: removeIds } },
        });
      }
    }

    if (addIds.length > 0) {
      const existingCount = await tx.databaseRowLink.count({
        where: prop.relation!.owner
          ? { propertyId: ownerPropId, sourceRowId: rowId }
          : { propertyId: ownerPropId, targetRowId: rowId },
      });
      if (existingCount + addIds.length > DATABASE_LIMITS.relationLinks) {
        throw new DatabaseError(422, `单个单元格最多关联 ${DATABASE_LIMITS.relationLinks} 条记录`);
      }

      for (const [idx, tid] of addIds.entries()) {
        const sourceRowId = prop.relation!.owner ? rowId : tid;
        const targetRowId = prop.relation!.owner ? tid : rowId;
        await tx.databaseRowLink.upsert({
          where: { propertyId_sourceRowId_targetRowId: { propertyId: ownerPropId, sourceRowId, targetRowId } },
          update: {},
          create: {
            sourceDatabaseId: srcDbId,
            propertyId: ownerPropId,
            sourceRowId,
            targetDatabaseId: tgtDbId,
            targetRowId,
            sortOrder: existingCount + idx,
          },
        });
      }
    }
    await tx.document.update({ where: { id: rowId }, data: { updatedById: user.id } });
  });

  const payload = await getDatabasePayload(user, databaseId, { includeRows: true });
  return payload.rows.find((r) => r.id === rowId) ?? null;
}

export async function createDatabaseRow(
  user: DocUser,
  databaseId: string,
  input: { title?: string; icon?: string | null; properties?: Record<string, PropertyValue | null> },
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  const count = await db.document.count({ where: { parentId: databaseId, kind: "row", deletedAt: null } });
  if (count >= DATABASE_LIMITS.rows) {
    throw new DatabaseError(422, `单个多维表格最多支持 ${DATABASE_LIMITS.rows} 行`);
  }

  const propsById = new Map(meta.properties.map((p) => [p.id, p]));
  const rawPatch = input.properties ?? {};
  for (const [propId, val] of Object.entries(rawPatch)) {
    const def = propsById.get(propId);
    if (!def || def.deletedAt) continue;
    const err = validatePropertyValue(def, val);
    if (err) throw new DatabaseError(422, err, "PROPERTY_INVALID");
  }

  const rowProps = applyRowPatch({}, rawPatch);
  const last = await db.document.findFirst({
    where: { parentId: databaseId, kind: "row", deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const members = await getMentionableUsers(meta.doc.space);
  const text = rowSearchText(meta.properties, rowProps, new Map(members.map((m) => [m.id, m])));

  const created = await db.document.create({
    data: {
      spaceId: meta.doc.spaceId,
      parentId: databaseId,
      kind: "row",
      title: (input.title ?? "").trim(),
      icon: input.icon ?? null,
      content: NEW_ROW_CONTENT,
      text,
      properties: JSON.stringify(rowProps),
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdById: user.id,
      updatedById: user.id,
    },
  });

  const payload = await getDatabasePayload(user, databaseId, { includeRows: true });
  return payload.rows.find((r) => r.id === created.id)!;
}

export async function updateDatabaseRow(
  user: DocUser,
  databaseId: string,
  rowId: string,
  input: { title?: string; icon?: string | null; cover?: string | null; properties?: Record<string, PropertyValue | null> },
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  const existing = await db.document.findFirst({
    where: { id: rowId, parentId: databaseId, kind: "row", deletedAt: null },
    select: { id: true, title: true, icon: true, cover: true, content: true, properties: true },
  });
  if (!existing) throw new DatabaseError(404, "记录不存在");

  const propsById = new Map(meta.properties.map((p) => [p.id, p]));
  const currentProps = parseRowPropsJson(existing.properties);
  let nextProps = currentProps;

  if (input.properties) {
    for (const [propId, val] of Object.entries(input.properties)) {
      const def = propsById.get(propId);
      if (!def || def.deletedAt) continue;
      const err = validatePropertyValue(def, val);
      if (err) throw new DatabaseError(422, err, "PROPERTY_INVALID");
    }
    nextProps = applyRowPatch(currentProps, input.properties);
  }

  const members = await getMentionableUsers(meta.doc.space);
  const bodyText = extractText(parseContent(existing.content));
  const propText = rowSearchText(meta.properties, nextProps, new Map(members.map((m) => [m.id, m])));

  await db.document.update({
    where: { id: rowId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.icon !== undefined ? { icon: input.icon || null } : {}),
      ...(input.cover !== undefined ? { cover: input.cover || null } : {}),
      ...(input.properties !== undefined ? { properties: JSON.stringify(nextProps) } : {}),
      text: [bodyText, propText].filter(Boolean).join("\n"),
      updatedById: user.id,
    },
  });

  const payload = await getDatabasePayload(user, databaseId, { includeRows: true });
  return payload.rows.find((r) => r.id === rowId)!;
}

export async function trashDatabaseRows(user: DocUser, databaseId: string, rowIds: string[]) {
  await requireDatabaseAccess(user, databaseId, true);
  const unique = [...new Set(rowIds)].slice(0, DATABASE_LIMITS.bulk);
  if (unique.length === 0) return { deleted: 0 };
  const now = new Date();
  const res = await db.document.updateMany({
    where: { id: { in: unique }, parentId: databaseId, kind: "row", deletedAt: null },
    data: { deletedAt: now, updatedById: user.id },
  });
  return { deleted: res.count };
}

export async function duplicateDatabaseRows(user: DocUser, databaseId: string, rowIds: string[]) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  const unique = [...new Set(rowIds)].slice(0, DATABASE_LIMITS.bulk);
  if (unique.length === 0) return { createdIds: [] };

  const currentCount = await db.document.count({ where: { parentId: databaseId, kind: "row", deletedAt: null } });
  if (currentCount + unique.length > DATABASE_LIMITS.rows) {
    throw new DatabaseError(422, `超出多维表格最大行数限制（${DATABASE_LIMITS.rows}）`);
  }

  const originals = await db.document.findMany({
    where: { id: { in: unique }, parentId: databaseId, kind: "row", deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const last = await db.document.findFirst({
    where: { parentId: databaseId, kind: "row", deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let nextOrder = (last?.sortOrder ?? -1) + 1;

  const createdIds: string[] = [];
  await db.$transaction(async (tx) => {
    for (const orig of originals) {
      const created = await tx.document.create({
        data: {
          spaceId: meta.doc.spaceId,
          parentId: databaseId,
          kind: "row",
          title: orig.title ? `${orig.title}（副本）` : "副本",
          icon: orig.icon,
          cover: orig.cover,
          content: orig.content,
          text: orig.text,
          properties: orig.properties,
          sortOrder: nextOrder++,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      createdIds.push(created.id);
    }
  });
  return { createdIds };
}

export async function bulkUpdateDatabaseRows(
  user: DocUser,
  databaseId: string,
  rowIds: string[],
  patch: Record<string, PropertyValue | null>,
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  const unique = [...new Set(rowIds)].slice(0, DATABASE_LIMITS.bulk);
  if (unique.length === 0) return { updated: 0 };

  const propsById = new Map(meta.properties.map((p) => [p.id, p]));
  for (const [propId, val] of Object.entries(patch)) {
    const def = propsById.get(propId);
    if (!def || def.deletedAt) continue;
    const err = validatePropertyValue(def, val);
    if (err) throw new DatabaseError(422, err, "PROPERTY_INVALID");
  }

  const rows = await db.document.findMany({
    where: { id: { in: unique }, parentId: databaseId, kind: "row", deletedAt: null },
    select: { id: true, content: true, properties: true },
  });
  const members = await getMentionableUsers(meta.doc.space);
  const membersById = new Map(members.map((m) => [m.id, m]));

  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const nextProps = applyRowPatch(parseRowPropsJson(r.properties), patch);
      const bodyText = extractText(parseContent(r.content));
      const propText = rowSearchText(meta.properties, nextProps, membersById);
      await tx.document.update({
        where: { id: r.id },
        data: {
          properties: JSON.stringify(nextProps),
          text: [bodyText, propText].filter(Boolean).join("\n"),
          updatedById: user.id,
        },
      });
    }
  });
  return { updated: rows.length };
}

export async function reorderDatabaseRows(user: DocUser, databaseId: string, orderedRowIds: string[]) {
  await requireDatabaseAccess(user, databaseId, true);
  const existing = await db.document.findMany({
    where: { parentId: databaseId, kind: "row", deletedAt: null },
    select: { id: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const validSet = new Set(existing.map((e) => e.id));
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of orderedRowIds) {
    if (validSet.has(id) && !seen.has(id)) {
      merged.push(id);
      seen.add(id);
    }
  }
  for (const e of existing) {
    if (!seen.has(e.id)) merged.push(e.id);
  }
  await db.$transaction(
    merged.map((id, idx) => db.document.update({ where: { id }, data: { sortOrder: idx } })),
  );
  return { reordered: merged.length };
}

export async function importRowsBatch(
  user: DocUser,
  databaseId: string,
  rowsInput: { title: string; properties: Record<string, PropertyValue | null> }[],
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  if (rowsInput.length > DATABASE_LIMITS.bulk) {
    throw new DatabaseError(422, `单次最多导入 ${DATABASE_LIMITS.bulk} 行`);
  }
  const currentCount = await db.document.count({ where: { parentId: databaseId, kind: "row", deletedAt: null } });
  if (currentCount + rowsInput.length > DATABASE_LIMITS.rows) {
    throw new DatabaseError(422, `导入后超出最大行数限制（${DATABASE_LIMITS.rows}）`);
  }

  const last = await db.document.findFirst({
    where: { parentId: databaseId, kind: "row", deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let nextOrder = (last?.sortOrder ?? -1) + 1;
  const propsById = new Map(meta.properties.map((p) => [p.id, p]));
  const members = await getMentionableUsers(meta.doc.space);
  const membersById = new Map(members.map((m) => [m.id, m]));

  let createdCount = 0;
  await db.$transaction(async (tx) => {
    for (const item of rowsInput) {
      const sanitized: Record<string, PropertyValue | null> = {};
      for (const [propId, val] of Object.entries(item.properties)) {
        const def = propsById.get(propId);
        if (!def || def.deletedAt) continue;
        if (validatePropertyValue(def, val) === null) {
          sanitized[propId] = val;
        }
      }
      const nextProps = applyRowPatch({}, sanitized);
      const text = rowSearchText(meta.properties, nextProps, membersById);
      await tx.document.create({
        data: {
          spaceId: meta.doc.spaceId,
          parentId: databaseId,
          kind: "row",
          title: item.title.trim().slice(0, 200),
          content: NEW_ROW_CONTENT,
          text,
          properties: JSON.stringify(nextProps),
          sortOrder: nextOrder++,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      createdCount++;
    }
  });

  return { imported: createdCount };
}

export async function listSchemaHistory(
  user: DocUser,
  databaseId: string,
  opts: { before?: number; limit?: number } = {},
): Promise<{ versions: SchemaHistorySummary[]; nextBefore: number | null }> {
  await requireDatabaseAccess(user, databaseId, false);
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const rows = await db.databaseSchemaVersion.findMany({
    where: {
      databaseId,
      ...(opts.before !== undefined ? { revision: { lt: opts.before } } : {}),
    },
    orderBy: { revision: "desc" },
    take: limit + 1,
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Fetch the version immediately preceding the oldest item in this page to compute its diff
  const oldestRev = page[page.length - 1]?.revision;
  const olderNeighbor =
    oldestRev !== undefined
      ? await db.databaseSchemaVersion.findFirst({
          where: { databaseId, revision: { lt: oldestRev } },
          orderBy: { revision: "desc" },
        })
      : null;

  const versions: SchemaHistorySummary[] = page.map((item, idx) => {
    const prevRow = idx + 1 < page.length ? page[idx + 1] : olderNeighbor;
    const prevSnap = prevRow ? parseSchemaJson(prevRow.properties, prevRow.views) : null;
    const curSnap = parseSchemaJson(item.properties, item.views);
    const allChanges = diffDatabaseSchemas(prevSnap, curSnap);
    return {
      revision: item.revision,
      kind: item.kind as SchemaHistorySummary["kind"],
      sourceRevision: item.sourceRevision,
      actor: item.actor,
      createdAt: item.createdAt.toISOString(),
      changes: allChanges.slice(0, 6),
      totalChanges: allChanges.length,
    };
  });

  return {
    versions,
    nextBefore: hasMore ? page[page.length - 1].revision : null,
  };
}

export async function getSchemaHistoryDetail(
  user: DocUser,
  databaseId: string,
  revision: number,
): Promise<SchemaHistoryDetail> {
  const meta = await requireDatabaseAccess(user, databaseId, false);
  const ver = await db.databaseSchemaVersion.findUnique({
    where: { databaseId_revision: { databaseId, revision } },
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
  });
  if (!ver) throw new DatabaseError(404, "该结构历史版本不存在");

  const prevVer = await db.databaseSchemaVersion.findFirst({
    where: { databaseId, revision: { lt: revision } },
    orderBy: { revision: "desc" },
  });

  const snap = parseSchemaJson(ver.properties, ver.views);
  const prevSnap = prevVer ? parseSchemaJson(prevVer.properties, prevVer.views) : null;
  const changes = diffDatabaseSchemas(prevSnap, snap);
  const diffFromCurrent = diffDatabaseSchemas({ properties: meta.properties, views: meta.views }, snap);

  return {
    revision: ver.revision,
    kind: ver.kind as SchemaHistorySummary["kind"],
    sourceRevision: ver.sourceRevision,
    actor: ver.actor,
    createdAt: ver.createdAt.toISOString(),
    changes,
    totalChanges: changes.length,
    properties: snap.properties,
    views: snap.views,
    diffFromCurrent,
  };
}

export async function restoreSchemaVersion(
  user: DocUser,
  databaseId: string,
  targetRevision: number,
  expectedRevision?: number,
) {
  const meta = await requireDatabaseAccess(user, databaseId, true);
  if (expectedRevision !== undefined && expectedRevision !== meta.revision) {
    throw new DatabaseError(409, "多维表格结构已被其他人更新，请刷新后重试", "REVISION_CONFLICT");
  }
  const targetVer = await db.databaseSchemaVersion.findUnique({
    where: { databaseId_revision: { databaseId, revision: targetRevision } },
  });
  if (!targetVer) throw new DatabaseError(404, "目标历史版本不存在");

  const targetSnap = parseSchemaJson(targetVer.properties, targetVer.views);
  const relDbIds = [
    ...new Set(
      [...meta.properties, ...targetSnap.properties]
        .filter((p) => p.type === "relation" && p.relation?.databaseId)
        .map((p) => p.relation!.databaseId),
    ),
  ];
  const aliveDbs = relDbIds.length
    ? await db.document.findMany({
        where: { id: { in: relDbIds }, kind: "database", deletedAt: null },
        select: { id: true },
      })
    : [];
  const availableSet = new Set(aliveDbs.map((d) => d.id));

  const plan = planSchemaRestore({ properties: meta.properties, views: meta.views }, targetSnap, availableSet);
  const saved = await saveDatabaseSchema(user, databaseId, {
    properties: plan.properties,
    views: plan.views,
    expectedRevision: meta.revision,
    kind: "restore",
    sourceRevision: targetRevision,
  });

  return { ...saved, notes: plan.notes };
}
