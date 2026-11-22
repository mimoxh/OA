import {
  PROPERTY_TYPE_LABEL,
  VIEW_TYPE_LABEL,
  retainFilters,
  type DatabaseView,
  type PropertyDefinition,
} from "./types";

export interface SchemaSnapshot {
  properties: PropertyDefinition[];
  views: DatabaseView[];
}

export function diffDatabaseSchemas(prev: SchemaSnapshot | null, next: SchemaSnapshot): string[] {
  if (!prev) {
    return [`初始化结构（${next.properties.filter((p) => !p.deletedAt).length} 个字段，${next.views.length} 个视图）`];
  }

  const changes: string[] = [];
  const prevProps = new Map(prev.properties.map((p) => [p.id, p]));
  const nextProps = new Map(next.properties.map((p) => [p.id, p]));

  for (const p of next.properties) {
    const old = prevProps.get(p.id);
    if (!old) {
      changes.push(`新增字段「${p.name}」（${PROPERTY_TYPE_LABEL[p.type]}）`);
      continue;
    }
    if (!old.deletedAt && p.deletedAt) {
      changes.push(`删除字段「${old.name}」`);
      continue;
    }
    if (old.deletedAt && !p.deletedAt) {
      changes.push(`恢复字段「${p.name}」`);
    }
    if (old.name !== p.name) {
      changes.push(`重命名字段「${old.name}」→「${p.name}」`);
    }
    if (old.type !== p.type) {
      changes.push(`更改字段「${p.name}」类型：${PROPERTY_TYPE_LABEL[old.type]} → ${PROPERTY_TYPE_LABEL[p.type]}`);
    }
    if (JSON.stringify(old.options ?? []) !== JSON.stringify(p.options ?? [])) {
      changes.push(`更新字段「${p.name}」选项配置`);
    }
    if (JSON.stringify(old.formula ?? null) !== JSON.stringify(p.formula ?? null)) {
      changes.push(`更新公式「${p.name}」`);
    }
    if (JSON.stringify(old.rollup ?? null) !== JSON.stringify(p.rollup ?? null)) {
      changes.push(`更新汇总「${p.name}」`);
    }
  }

  for (const old of prev.properties) {
    if (!nextProps.has(old.id)) {
      changes.push(`移除字段「${old.name}」`);
    }
  }

  const prevViews = new Map(prev.views.map((v) => [v.id, v]));
  const nextViews = new Map(next.views.map((v) => [v.id, v]));

  for (const v of next.views) {
    const old = prevViews.get(v.id);
    if (!old) {
      changes.push(`新增视图「${v.name}」（${VIEW_TYPE_LABEL[v.type]}）`);
      continue;
    }
    if (old.name !== v.name) {
      changes.push(`重命名视图「${old.name}」→「${v.name}」`);
    }
    if (old.type !== v.type) {
      changes.push(`切换视图「${v.name}」类型：${VIEW_TYPE_LABEL[old.type]} → ${VIEW_TYPE_LABEL[v.type]}`);
    }
    if (
      JSON.stringify(old.filters) !== JSON.stringify(v.filters) ||
      JSON.stringify(old.sorts) !== JSON.stringify(v.sorts) ||
      old.groupPropertyId !== v.groupPropertyId ||
      old.datePropertyId !== v.datePropertyId
    ) {
      changes.push(`调整视图「${v.name}」筛选/排序/分组`);
    } else if (
      JSON.stringify(old.hiddenPropertyIds) !== JSON.stringify(v.hiddenPropertyIds) ||
      JSON.stringify(old.propertyOrder) !== JSON.stringify(v.propertyOrder) ||
      JSON.stringify(old.aggregates ?? {}) !== JSON.stringify(v.aggregates ?? {})
    ) {
      changes.push(`调整视图「${v.name}」列展示`);
    }
  }

  for (const old of prev.views) {
    if (!nextViews.has(old.id)) {
      changes.push(`删除视图「${old.name}」`);
    }
  }

  if (changes.length === 0) changes.push("更新列宽或细微布局");
  return changes;
}

export interface RestorePlan {
  properties: PropertyDefinition[];
  views: DatabaseView[];
  notes: string[];
}

/**
 * Non-destructive restore planner (NBase pattern):
 * - Never hard-removes fields: fields added after target version are soft-deleted; fields present in target are restored.
 * - Relation fields keep their current pairing config; if target database is unavailable, keep soft-deleted and add a note.
 * - Filters/sorts referencing unavailable fields are pruned from restored views.
 */
export function planSchemaRestore(
  current: SchemaSnapshot,
  target: SchemaSnapshot,
  availableDatabaseIds: ReadonlySet<string>,
  nowIso = new Date().toISOString(),
): RestorePlan {
  const notes: string[] = [];
  const currentById = new Map(current.properties.map((p) => [p.id, p]));
  const targetById = new Map(target.properties.map((p) => [p.id, p]));
  const restoredProps: PropertyDefinition[] = [];

  for (const tp of target.properties) {
    const cur = currentById.get(tp.id);
    if (tp.type === "relation" || cur?.type === "relation") {
      // Preserve live pairing config; only restore name and deleted state if target DB still exists
      const base = cur ?? tp;
      const targetDbId = base.relation?.databaseId;
      const available = !targetDbId || availableDatabaseIds.has(targetDbId);
      if (!available && !tp.deletedAt) {
        notes.push(`关联字段「${tp.name}」的目标表格已删除，保持软删除状态`);
        restoredProps.push({ ...base, name: tp.name, deletedAt: base.deletedAt ?? nowIso });
      } else {
        restoredProps.push({ ...base, name: tp.name, deletedAt: tp.deletedAt ?? null });
      }
      continue;
    }
    restoredProps.push({
      ...tp,
      deletedAt: tp.deletedAt ?? null,
    });
  }

  // Keep fields added after target version as soft-deleted so row data is never lost
  for (const cp of current.properties) {
    if (!targetById.has(cp.id)) {
      restoredProps.push({
        ...cp,
        deletedAt: cp.deletedAt ?? nowIso,
      });
      if (!cp.deletedAt) {
        notes.push(`字段「${cp.name}」在该版本之后新增，已改为软删除（行数据仍保留）`);
      }
    }
  }

  const activeIds = new Set(restoredProps.filter((p) => !p.deletedAt).map((p) => p.id));
  const activeById = new Map(restoredProps.filter((p) => !p.deletedAt).map((p) => [p.id, p]));

  // Warn about rollups whose relation is unavailable
  for (const p of restoredProps) {
    if (!p.deletedAt && p.type === "rollup" && p.rollup) {
      const rel = activeById.get(p.rollup.relationPropertyId);
      if (!rel || rel.type !== "relation") {
        notes.push(`汇总字段「${p.name}」引用的关联字段当前不可用`);
      }
    }
  }

  const views: DatabaseView[] = target.views.map((v) => {
    const prunedFilters = retainFilters(v.filters, (f) => activeIds.has(f.propertyId));
    const prunedSorts = v.sorts.filter((s) => activeIds.has(s.propertyId));
    if (prunedFilters.length !== v.filters.length || prunedSorts.length !== v.sorts.length) {
      notes.push(`视图「${v.name}」中引用不可用字段的筛选或排序已清理`);
    }
    return {
      ...v,
      filters: prunedFilters,
      sorts: prunedSorts,
      groupPropertyId: v.groupPropertyId && activeIds.has(v.groupPropertyId) ? v.groupPropertyId : undefined,
      datePropertyId: v.datePropertyId && activeIds.has(v.datePropertyId) ? v.datePropertyId : undefined,
    };
  });

  return { properties: restoredProps, views, notes };
}
