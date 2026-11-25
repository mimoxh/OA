import {
  dateCellRange,
  displayDateCell,
  isDateValue,
  localDay,
  rangesOverlap,
  resolveRelativeDate,
  type DayRange,
} from "./date-cells";
import { randomId } from "@/lib/client-id";
import { extractFormulaDependencies, validateFormulaSyntax } from "./formula";
import {
  AGGREGATE_FUNCTIONS,
  COMPUTED_RESULT_TYPES,
  DATABASE_LIMITS,
  DATABASE_VIEW_TYPES,
  FILTER_OPERATORS,
  OPTION_COLORS,
  PROPERTY_TYPES,
  ROLLUP_FUNCTIONS,
  effectiveType,
  flatFilters,
  isFilterGroup,
  isStoredPropertyType,
  type AggregateFunction,
  type DatabaseRow,
  type DatabaseView,
  type FilterOperator,
  type PersonOption,
  type PropertyDefinition,
  type PropertyType,
  type PropertyValue,
  type RowProperties,
  type ViewFilter,
  type ViewFilterEntry,
} from "./types";

export function makeId(prefix: string): string {
  return `${prefix}_${randomId().replace(/-/g, "").slice(0, 12)}`;
}

export function defaultDatabaseSchema(): { properties: PropertyDefinition[]; views: DatabaseView[] } {
  const titleId = makeId("prop");
  const statusId = makeId("prop");
  const ownerId = makeId("prop");
  const dateId = makeId("prop");
  const viewId = makeId("view");
  const boardId = makeId("view");

  const properties: PropertyDefinition[] = [
    { id: titleId, name: "名称", type: "title" },
    {
      id: statusId,
      name: "状态",
      type: "select",
      options: [
        { id: makeId("opt"), name: "待开始", color: "gray" },
        { id: makeId("opt"), name: "进行中", color: "blue" },
        { id: makeId("opt"), name: "已完成", color: "green" },
      ],
    },
    { id: ownerId, name: "负责人", type: "person" },
    { id: dateId, name: "日期", type: "date" },
  ];

  const views: DatabaseView[] = [
    {
      id: viewId,
      name: "全部记录",
      type: "table",
      filters: [],
      sorts: [],
      hiddenPropertyIds: [],
      propertyOrder: [statusId, ownerId, dateId],
      widths: { [titleId]: 240, [statusId]: 130, [ownerId]: 140, [dateId]: 160 },
      aggregates: { [titleId]: "count" },
    },
    {
      id: boardId,
      name: "状态看板",
      type: "board",
      groupPropertyId: statusId,
      filters: [],
      sorts: [],
      hiddenPropertyIds: [],
      propertyOrder: [ownerId, dateId],
      widths: {},
    },
  ];

  return { properties, views };
}

export function isUrlValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s || s.length > DATABASE_LIMITS.urlValue) return false;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function activeProperties(properties: readonly PropertyDefinition[]): PropertyDefinition[] {
  return properties.filter((p) => !p.deletedAt);
}

export function viewColumns(properties: readonly PropertyDefinition[], view: DatabaseView): PropertyDefinition[] {
  const active = activeProperties(properties);
  const title = active.find((p) => p.type === "title");
  const hidden = new Set(view.hiddenPropertyIds);
  const byId = new Map(active.map((p) => [p.id, p]));
  const ordered: PropertyDefinition[] = [];
  const seen = new Set<string>();

  if (title) {
    ordered.push(title);
    seen.add(title.id);
  }
  for (const id of view.propertyOrder) {
    const def = byId.get(id);
    if (def && !seen.has(def.id) && !hidden.has(def.id)) {
      ordered.push(def);
      seen.add(def.id);
    }
  }
  for (const def of active) {
    if (!seen.has(def.id) && !hidden.has(def.id)) {
      ordered.push(def);
      seen.add(def.id);
    }
  }
  return ordered;
}

export function filterOperatorsFor(type: PropertyType): readonly FilterOperator[] {
  switch (type) {
    case "checkbox":
      return ["is_checked", "is_not_checked"];
    case "number":
      return ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"];
    case "date":
    case "created_time":
    case "updated_time":
      return ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"];
    case "select":
    case "person":
      return ["equals", "not_equals", "is_empty", "is_not_empty"];
    case "multi_select":
    case "relation":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "title":
    case "text":
    case "url":
    default:
      return ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty"];
  }
}

export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== "is_empty" && op !== "is_not_empty" && op !== "is_checked" && op !== "is_not_checked";
}

export function aggregatesFor(type: PropertyType): readonly AggregateFunction[] {
  if (type === "number") return AGGREGATE_FUNCTIONS;
  if (type === "date" || type === "created_time" || type === "updated_time") {
    return ["count", "count_values", "count_empty", "min", "max"];
  }
  return ["count", "count_values", "count_empty"];
}

export function isGroupableProperty(def: PropertyDefinition): boolean {
  if (def.deletedAt) return false;
  return def.type === "select" || def.type === "multi_select" || def.type === "checkbox" || def.type === "person";
}

export function isCalendarProperty(def: PropertyDefinition): boolean {
  if (def.deletedAt) return false;
  const eff = effectiveType(def);
  return eff === "date" || eff === "created_time" || eff === "updated_time";
}

export function validatePropertyValue(def: PropertyDefinition, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isStoredPropertyType(def.type)) {
    return `字段「${def.name}」为只读或关联字段，不能直接写入属性值`;
  }
  switch (def.type) {
    case "text":
      if (typeof value !== "string") return `字段「${def.name}」必须为文本`;
      if (value.length > DATABASE_LIMITS.textValue) return `字段「${def.name}」文本超过 ${DATABASE_LIMITS.textValue} 字`;
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return `字段「${def.name}」必须为有效数字`;
      return null;
    case "checkbox":
      if (typeof value !== "boolean") return `字段「${def.name}」必须为布尔值`;
      return null;
    case "url":
      if (typeof value !== "string") return `字段「${def.name}」必须为网址`;
      if (value.trim() !== "" && !isUrlValue(value)) return `字段「${def.name}」网址格式无效`;
      return null;
    case "date":
      if (typeof value !== "string" || !isDateValue(value)) return `字段「${def.name}」日期格式无效（应为 YYYY-MM-DD）`;
      return null;
    case "select":
      if (typeof value !== "string") return `字段「${def.name}」选项值无效`;
      return null;
    case "multi_select":
      if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) return `字段「${def.name}」必须为选项数组`;
      if (value.length > DATABASE_LIMITS.multiSelect) return `字段「${def.name}」最多选择 ${DATABASE_LIMITS.multiSelect} 项`;
      return null;
    case "person":
      if (typeof value !== "string") return `字段「${def.name}」必须为成员 ID`;
      return null;
    default:
      return null;
  }
}

export function applyRowPatch(
  current: RowProperties,
  patch: Record<string, PropertyValue | null | undefined>,
): RowProperties {
  const next: RowProperties = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
      delete next[k];
    } else {
      next[k] = v;
    }
  }
  return next;
}

/** Validate local database schema (does not perform cross-DB rollup cycle checks; server handles cross-DB) */
export function validateDatabaseSchema(
  properties: unknown,
  views: unknown,
  previousProperties?: readonly PropertyDefinition[],
): string | null {
  if (!Array.isArray(properties) || properties.length === 0) return "字段列表不能为空";
  if (properties.length > DATABASE_LIMITS.properties) return `字段数量不能超过 ${DATABASE_LIMITS.properties} 个`;
  if (!Array.isArray(views) || views.length === 0) return "至少需要保留一个视图";
  if (views.length > DATABASE_LIMITS.views) return `视图数量不能超过 ${DATABASE_LIMITS.views} 个`;

  const propIds = new Set<string>();
  let titleCount = 0;

  for (const raw of properties) {
    if (!raw || typeof raw !== "object") return "字段定义格式无效";
    const p = raw as PropertyDefinition;
    if (typeof p.id !== "string" || !p.id.trim()) return "字段 ID 无效";
    if (propIds.has(p.id)) return `存在重复的字段 ID：${p.id}`;
    propIds.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > DATABASE_LIMITS.name) {
      return `字段名称不能为空且不超过 ${DATABASE_LIMITS.name} 字符`;
    }
    if (!(PROPERTY_TYPES as readonly string[]).includes(p.type)) return `不支持的字段类型：${String(p.type)}`;
    if (p.type === "title") {
      if (p.deletedAt) return "标题字段不能删除";
      titleCount++;
    }
    if (p.options !== undefined) {
      if (!Array.isArray(p.options) || p.options.length > DATABASE_LIMITS.options) {
        return `字段「${p.name}」选项数量无效或超过 ${DATABASE_LIMITS.options}`;
      }
      const optIds = new Set<string>();
      for (const o of p.options) {
        if (!o || typeof o.id !== "string" || !o.id || optIds.has(o.id)) return `字段「${p.name}」选项 ID 无效或重复`;
        optIds.add(o.id);
        if (typeof o.name !== "string" || !o.name.trim() || o.name.length > DATABASE_LIMITS.name) {
          return `字段「${p.name}」存在空选项名`;
        }
        if (!(OPTION_COLORS as readonly string[]).includes(o.color)) return `字段「${p.name}」选项颜色无效`;
      }
    }
    if (p.type === "formula" && !p.deletedAt) {
      if (!p.formula || typeof p.formula.expression !== "string") return `公式字段「${p.name}」缺少表达式`;
      if (!(COMPUTED_RESULT_TYPES as readonly string[]).includes(p.formula.resultType)) {
        return `公式字段「${p.name}」返回类型无效`;
      }
      const synErr = validateFormulaSyntax(p.formula.expression);
      if (synErr) return `公式字段「${p.name}」语法错误：${synErr}`;
    }
    if (p.type === "rollup" && !p.deletedAt) {
      if (!p.rollup) return `汇总字段「${p.name}」缺少配置`;
      if (!(ROLLUP_FUNCTIONS as readonly string[]).includes(p.rollup.fn)) {
        return `汇总字段「${p.name}」汇总函数无效`;
      }
      if (!(COMPUTED_RESULT_TYPES as readonly string[]).includes(p.rollup.resultType)) {
        return `汇总字段「${p.name}」返回类型无效`;
      }
    }
  }

  if (titleCount !== 1) return "多维表格必须有且仅有一个标题字段";

  // Soft-delete enforcement: never hard-remove existing fields or change title field identity
  if (previousProperties) {
    const prevTitle = previousProperties.find((p) => p.type === "title");
    const nextTitle = (properties as PropertyDefinition[]).find((p) => p.type === "title");
    if (prevTitle && nextTitle && prevTitle.id !== nextTitle.id) {
      return "不能更改标题字段的身份";
    }
    for (const prev of previousProperties) {
      if (!propIds.has(prev.id)) {
        return `字段「${prev.name}」不允许硬删除，请使用软删除`;
      }
    }
  }

  // Local formula cycle check
  const propsTyped = properties as PropertyDefinition[];
  const byId = new Map(propsTyped.map((p) => [p.id, p]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const checkCycle = (id: string, stack: string[]): string | null => {
    if (visited.has(id)) return null;
    if (visiting.has(id)) {
      const path = [...stack.slice(stack.indexOf(id)), id].map((k) => byId.get(k)?.name ?? k).join(" → ");
      return `公式存在循环依赖：${path}`;
    }
    const def = byId.get(id);
    if (!def || def.deletedAt || def.type !== "formula" || !def.formula) {
      visited.add(id);
      return null;
    }
    if (stack.length >= DATABASE_LIMITS.formulaDepth) {
      return `公式依赖深度超过上限（${DATABASE_LIMITS.formulaDepth} 层）`;
    }
    visiting.add(id);
    for (const dep of extractFormulaDependencies(def.formula.expression)) {
      if (byId.has(dep)) {
        const err = checkCycle(dep, [...stack, id]);
        if (err) return err;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const p of propsTyped) {
    if (p.type === "formula" && !p.deletedAt) {
      const err = checkCycle(p.id, []);
      if (err) return err;
    }
  }

  const viewIds = new Set<string>();
  for (const raw of views) {
    if (!raw || typeof raw !== "object") return "视图定义格式无效";
    const v = raw as DatabaseView;
    if (typeof v.id !== "string" || !v.id.trim() || viewIds.has(v.id)) return "视图 ID 无效或重复";
    viewIds.add(v.id);
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > DATABASE_LIMITS.name) {
      return `视图名称不能为空且不超过 ${DATABASE_LIMITS.name} 字符`;
    }
    if (!(DATABASE_VIEW_TYPES as readonly string[]).includes(v.type)) return `不支持的视图类型：${String(v.type)}`;
    if (!Array.isArray(v.filters) || !Array.isArray(v.sorts)) return "视图筛选或排序格式无效";
    if (flatFilters(v.filters).length > DATABASE_LIMITS.conditions) {
      return `单个视图的筛选条件不能超过 ${DATABASE_LIMITS.conditions} 个`;
    }
    for (const f of flatFilters(v.filters)) {
      if (!(FILTER_OPERATORS as readonly string[]).includes(f.operator)) return `不支持的筛选操作符：${String(f.operator)}`;
    }
  }

  return null;
}

/** Extract typed runtime value for a cell (returns undefined if value does not match current field type) */
export function cellValue(row: DatabaseRow, def: PropertyDefinition): PropertyValue | undefined {
  switch (def.type) {
    case "title":
      return row.title;
    case "created_time":
      return row.createdAt;
    case "updated_time":
      return row.updatedAt;
    case "formula":
    case "rollup":
      return row.computed?.[def.id];
    case "relation": {
      const cell = row.relations?.[def.id];
      return cell && cell.items.length > 0 ? cell.items.map((x) => x.id) : undefined;
    }
    default: {
      const raw = row.properties[def.id];
      if (raw === undefined || raw === null) return undefined;
      switch (def.type) {
        case "text":
        case "url":
        case "person":
          return typeof raw === "string" && raw !== "" ? raw : undefined;
        case "number":
          return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
        case "checkbox":
          return typeof raw === "boolean" ? raw : false;
        case "date":
          return typeof raw === "string" && isDateValue(raw) ? raw : undefined;
        case "select": {
          if (typeof raw !== "string") return undefined;
          const valid = def.options?.some((o) => o.id === raw);
          return valid ? raw : undefined;
        }
        case "multi_select": {
          if (!Array.isArray(raw)) return undefined;
          const validSet = new Set((def.options ?? []).map((o) => o.id));
          const filtered = raw.filter((id) => typeof id === "string" && validSet.has(id));
          return filtered.length ? filtered : undefined;
        }
        default:
          return undefined;
      }
    }
  }
}

export function cellText(
  row: DatabaseRow,
  def: PropertyDefinition,
  membersById?: ReadonlyMap<string, PersonOption>,
): string {
  if (def.type === "relation") {
    const cell = row.relations?.[def.id];
    if (!cell || cell.items.length === 0) return "";
    return cell.items.map((x) => x.title || "无标题").join(", ");
  }
  const v = cellValue(row, def);
  if (v === undefined) return "";
  switch (def.type) {
    case "select": {
      return def.options?.find((o) => o.id === v)?.name ?? "";
    }
    case "multi_select": {
      const names = (v as string[])
        .map((id) => def.options?.find((o) => o.id === id)?.name)
        .filter((s): s is string => !!s);
      return names.join(", ");
    }
    case "person": {
      return membersById?.get(String(v))?.name ?? String(v);
    }
    case "checkbox":
      return v ? "是" : "否";
    case "date":
      return displayDateCell(v);
    case "created_time":
    case "updated_time":
      return localDay(new Date(String(v)));
    case "formula":
    case "rollup": {
      const eff = effectiveType(def);
      if (eff === "checkbox") return v ? "是" : "否";
      if (eff === "date") return displayDateCell(v);
      return String(v);
    }
    default:
      return String(v);
  }
}

function rowDayRange(row: DatabaseRow, def: PropertyDefinition, timeZone?: string): DayRange | null {
  const v = cellValue(row, def);
  if (v === undefined) return null;
  const eff = effectiveType(def);
  if (eff === "created_time" || eff === "updated_time") {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) return null;
    const day = localDay(d, timeZone);
    return { start: day, end: day };
  }
  return dateCellRange(v);
}

function matchesFilter(
  row: DatabaseRow,
  filter: ViewFilter,
  byId: ReadonlyMap<string, PropertyDefinition>,
  today: string,
  timeZone?: string,
  membersById?: ReadonlyMap<string, PersonOption>,
): boolean {
  const def = byId.get(filter.propertyId);
  if (!def || def.deletedAt) return true;
  const eff = effectiveType(def);
  const val = cellValue(row, def);

  if (filter.operator === "is_checked") return val === true;
  if (filter.operator === "is_not_checked") return val !== true;
  if (filter.operator === "is_empty") {
    if (eff === "checkbox") return val !== true;
    return val === undefined || val === "" || (Array.isArray(val) && val.length === 0);
  }
  if (filter.operator === "is_not_empty") {
    if (eff === "checkbox") return val === true;
    return val !== undefined && val !== "" && (!Array.isArray(val) || val.length > 0);
  }

  const target = filter.value;
  if (target === undefined || target === null || target === "") return true;

  if (eff === "number") {
    if (typeof val !== "number") return false;
    const t = Number(target);
    if (!Number.isFinite(t)) return true;
    switch (filter.operator) {
      case "equals":
        return val === t;
      case "not_equals":
        return val !== t;
      case "gt":
        return val > t;
      case "gte":
        return val >= t;
      case "lt":
        return val < t;
      case "lte":
        return val <= t;
      default:
        return true;
    }
  }

  if (eff === "date" || eff === "created_time" || eff === "updated_time") {
    const rowRange = rowDayRange(row, def, timeZone);
    if (!rowRange) return filter.operator === "not_equals";
    const tStr = String(target);
    const targetRange = tStr.startsWith("@") ? resolveRelativeDate(tStr, today, 1) : dateCellRange(tStr);
    if (!targetRange) return true;
    switch (filter.operator) {
      case "equals":
        return rangesOverlap(rowRange, targetRange);
      case "not_equals":
        return !rangesOverlap(rowRange, targetRange);
      case "gt":
        return rowRange.start > targetRange.end;
      case "gte":
        return rowRange.end >= targetRange.start;
      case "lt":
        return rowRange.end < targetRange.start;
      case "lte":
        return rowRange.start <= targetRange.end;
      default:
        return true;
    }
  }

  if (def.type === "select" || def.type === "person") {
    const t = String(target);
    if (filter.operator === "equals") return val === t;
    if (filter.operator === "not_equals") return val !== t;
    return true;
  }

  if (def.type === "multi_select" || def.type === "relation") {
    const arr = Array.isArray(val) ? val : [];
    const t = String(target);
    if (filter.operator === "contains") return arr.includes(t);
    if (filter.operator === "not_contains") return !arr.includes(t);
    return true;
  }

  // Text / title / url / text-computed
  const text = cellText(row, def, membersById).toLowerCase();
  const needle = String(target).toLowerCase();
  switch (filter.operator) {
    case "contains":
      return text.includes(needle);
    case "not_contains":
      return !text.includes(needle);
    case "equals":
      return text === needle;
    case "not_equals":
      return text !== needle;
    default:
      return true;
  }
}

export function matchesFilterEntries(
  row: DatabaseRow,
  entries: readonly ViewFilterEntry[],
  byId: ReadonlyMap<string, PropertyDefinition>,
  today: string,
  timeZone?: string,
  membersById?: ReadonlyMap<string, PersonOption>,
): boolean {
  for (const entry of entries) {
    if (isFilterGroup(entry)) {
      if (entry.any.length === 0) continue;
      if (!entry.any.some((f) => matchesFilter(row, f, byId, today, timeZone, membersById))) return false;
    } else {
      if (!matchesFilter(row, entry, byId, today, timeZone, membersById)) return false;
    }
  }
  return true;
}

function compareRowsByProperty(
  a: DatabaseRow,
  b: DatabaseRow,
  def: PropertyDefinition,
  direction: "asc" | "desc",
  membersById?: ReadonlyMap<string, PersonOption>,
): number {
  const mul = direction === "asc" ? 1 : -1;
  const eff = effectiveType(def);

  if (eff === "checkbox") {
    const av = cellValue(a, def) === true ? 1 : 0;
    const bv = cellValue(b, def) === true ? 1 : 0;
    return (av - bv) * mul;
  }

  const av = cellValue(a, def);
  const bv = cellValue(b, def);
  const aEmpty = av === undefined || av === "" || (Array.isArray(av) && av.length === 0);
  const bEmpty = bv === undefined || bv === "" || (Array.isArray(bv) && bv.length === 0);
  // Empty values always sort last
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (eff === "number") {
    return ((av as number) - (bv as number)) * mul;
  }
  if (eff === "date" || eff === "created_time" || eff === "updated_time") {
    return String(av).localeCompare(String(bv)) * mul;
  }
  if (def.type === "select") {
    const order = new Map((def.options ?? []).map((o, idx) => [o.id, idx]));
    const ai = order.get(String(av)) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(String(bv)) ?? Number.MAX_SAFE_INTEGER;
    return (ai - bi) * mul;
  }
  const at = cellText(a, def, membersById);
  const bt = cellText(b, def, membersById);
  return at.localeCompare(bt, "zh-CN") * mul;
}

export function evaluateView(
  rows: readonly DatabaseRow[],
  properties: readonly PropertyDefinition[],
  view: DatabaseView,
  opts: {
    search?: string;
    membersById?: ReadonlyMap<string, PersonOption>;
    timeZone?: string;
    today?: string;
  } = {},
): DatabaseRow[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const active = activeProperties(properties);
  const today = opts.today ?? localDay(new Date(), opts.timeZone);
  const needle = opts.search?.trim().toLowerCase() ?? "";

  const filtered = rows.filter((row) => {
    if (!matchesFilterEntries(row, view.filters, byId, today, opts.timeZone, opts.membersById)) return false;
    if (needle) {
      const hitTitle = row.title.toLowerCase().includes(needle);
      if (hitTitle) return true;
      for (const def of active) {
        if (def.type === "title") continue;
        if (cellText(row, def, opts.membersById).toLowerCase().includes(needle)) return true;
      }
      return false;
    }
    return true;
  });

  const validSorts = view.sorts
    .map((s) => ({ def: byId.get(s.propertyId), direction: s.direction }))
    .filter((x): x is { def: PropertyDefinition; direction: "asc" | "desc" } => !!x.def && !x.def.deletedAt);

  return [...filtered].sort((a, b) => {
    for (const s of validSorts) {
      const cmp = compareRowsByProperty(a, b, s.def, s.direction, opts.membersById);
      if (cmp !== 0) return cmp;
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface RowGroup {
  key: string | null;
  label: string;
  color?: string;
  rows: DatabaseRow[];
}

export function groupRows(
  rows: readonly DatabaseRow[],
  def: PropertyDefinition,
  members: readonly PersonOption[] = [],
): RowGroup[] {
  const buckets = new Map<string | null, DatabaseRow[]>();
  const orderedKeys: { key: string | null; label: string; color?: string }[] = [];

  if (def.type === "select" || def.type === "multi_select") {
    for (const opt of def.options ?? []) {
      orderedKeys.push({ key: opt.id, label: opt.name, color: opt.color });
      buckets.set(opt.id, []);
    }
    orderedKeys.push({ key: null, label: "无选项" });
    buckets.set(null, []);

    for (const row of rows) {
      const v = cellValue(row, def);
      if (def.type === "select") {
        const k = typeof v === "string" && buckets.has(v) ? v : null;
        buckets.get(k)!.push(row);
      } else {
        const arr = Array.isArray(v) ? v.filter((id) => buckets.has(id)) : [];
        if (arr.length === 0) {
          buckets.get(null)!.push(row);
        } else {
          for (const k of arr) buckets.get(k)!.push(row);
        }
      }
    }
  } else if (def.type === "checkbox") {
    orderedKeys.push({ key: "true", label: "已勾选", color: "green" });
    orderedKeys.push({ key: "false", label: "未勾选", color: "gray" });
    buckets.set("true", []);
    buckets.set("false", []);
    for (const row of rows) {
      const k = cellValue(row, def) === true ? "true" : "false";
      buckets.get(k)!.push(row);
    }
  } else if (def.type === "person") {
    for (const m of members) {
      orderedKeys.push({ key: m.id, label: m.name });
      buckets.set(m.id, []);
    }
    orderedKeys.push({ key: null, label: "未分配" });
    buckets.set(null, []);
    for (const row of rows) {
      const v = cellValue(row, def);
      const k = typeof v === "string" && buckets.has(v) ? v : null;
      buckets.get(k)!.push(row);
    }
  } else {
    orderedKeys.push({ key: null, label: "全部" });
    buckets.set(null, [...rows]);
  }

  return orderedKeys.map((g) => ({ ...g, rows: buckets.get(g.key) ?? [] }));
}

export function groupMoveValue(
  def: PropertyDefinition,
  current: PropertyValue | undefined,
  fromKey: string | null,
  toKey: string | null,
): PropertyValue | null {
  if (def.type === "select" || def.type === "person") {
    return toKey;
  }
  if (def.type === "checkbox") {
    return toKey === "true";
  }
  if (def.type === "multi_select") {
    if (toKey === null) return null;
    const valid = new Set((def.options ?? []).map((o) => o.id));
    const arr = Array.isArray(current) ? current.filter((id) => valid.has(id)) : [];
    const next = arr.filter((id) => id !== fromKey);
    if (!next.includes(toKey)) next.push(toKey);
    return next.length ? next : null;
  }
  return null;
}

export function aggregateColumn(
  rows: readonly DatabaseRow[],
  def: PropertyDefinition,
  fn: AggregateFunction,
): number | string | null {
  if (fn === "count") return rows.length;
  const eff = effectiveType(def);
  const values = rows
    .map((r) => cellValue(r, def))
    .filter((v): v is PropertyValue => {
      if (v === undefined || v === "") return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });

  if (fn === "count_values") return values.length;
  if (fn === "count_empty") return rows.length - values.length;

  if (eff === "number") {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length === 0) return null;
    if (fn === "sum") return Math.round(nums.reduce((a, b) => a + b, 0) * 1_000_000) / 1_000_000;
    if (fn === "avg") return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1_000_000) / 1_000_000;
    if (fn === "min") return Math.min(...nums);
    if (fn === "max") return Math.max(...nums);
  }

  if (eff === "date" || eff === "created_time" || eff === "updated_time") {
    const days = values
      .map((v) => {
        if (eff === "created_time" || eff === "updated_time") return localDay(new Date(String(v)));
        return dateCellRange(v)?.start ?? null;
      })
      .filter((d): d is string => !!d)
      .sort();
    if (days.length === 0) return null;
    if (fn === "min") return days[0];
    if (fn === "max") return days[days.length - 1];
  }
  return null;
}

export function rowSearchText(
  properties: readonly PropertyDefinition[],
  values: RowProperties,
  membersById?: ReadonlyMap<string, PersonOption>,
): string {
  const parts: string[] = [];
  for (const def of activeProperties(properties)) {
    const raw = values[def.id];
    if (raw === undefined || raw === null) continue;
    if (def.type === "text" || def.type === "url") {
      if (typeof raw === "string" && raw.trim()) parts.push(raw.trim());
    } else if (def.type === "select" && typeof raw === "string") {
      const opt = def.options?.find((o) => o.id === raw);
      if (opt) parts.push(opt.name);
    } else if (def.type === "multi_select" && Array.isArray(raw)) {
      for (const id of raw) {
        const opt = def.options?.find((o) => o.id === id);
        if (opt) parts.push(opt.name);
      }
    } else if (def.type === "person" && typeof raw === "string") {
      const m = membersById?.get(raw);
      if (m) parts.push(m.name);
    }
  }
  return parts.join(" ");
}
