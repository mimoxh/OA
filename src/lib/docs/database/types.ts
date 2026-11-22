export const DOCUMENT_KINDS = ["page", "database", "row"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "person",
  "created_time",
  "updated_time",
  "relation",
  "formula",
  "rollup",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const STORED_PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "person",
] as const;
export type StoredPropertyType = (typeof STORED_PROPERTY_TYPES)[number];

export const OPTION_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export const OPTION_COLOR_STYLE: Record<OptionColor, { label: string; badge: string; dot: string }> = {
  default: { label: "默认", badge: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  gray: { label: "灰色", badge: "bg-zinc-100 text-zinc-700 border-zinc-200", dot: "bg-zinc-400" },
  brown: { label: "棕色", badge: "bg-stone-200/80 text-stone-800 border-stone-300", dot: "bg-stone-500" },
  orange: { label: "橙色", badge: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  yellow: { label: "黄色", badge: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  green: { label: "绿色", badge: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  blue: { label: "蓝色", badge: "bg-sky-100 text-sky-800 border-sky-200", dot: "bg-sky-500" },
  purple: { label: "紫色", badge: "bg-violet-100 text-violet-800 border-violet-200", dot: "bg-violet-500" },
  pink: { label: "粉色", badge: "bg-pink-100 text-pink-800 border-pink-200", dot: "bg-pink-500" },
  red: { label: "红色", badge: "bg-rose-100 text-rose-800 border-rose-200", dot: "bg-rose-500" },
};

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  title: "标题",
  text: "文本",
  number: "数字",
  select: "单选",
  multi_select: "多选",
  date: "日期",
  checkbox: "复选框",
  url: "网址",
  person: "人员",
  created_time: "创建时间",
  updated_time: "更新时间",
  relation: "关联",
  formula: "公式",
  rollup: "汇总",
};

export const DATABASE_LIMITS = {
  properties: 100,
  options: 200,
  views: 20,
  conditions: 20,
  rows: 10000,
  bulk: 500,
  relationLinks: 500,
  name: 100,
  textValue: 2000,
  urlValue: 2048,
  multiSelect: 50,
  formulaDepth: 10,
  columnWidthMin: 80,
  columnWidthMax: 640,
  columnWidthDefault: 170,
} as const;

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
}

export const ROLLUP_FUNCTIONS = ["count", "count_values", "sum", "avg", "min", "max"] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

export const ROLLUP_FUNCTION_LABEL: Record<RollupFunction, string> = {
  count: "关联总数",
  count_values: "非空计数",
  sum: "求和",
  avg: "平均值",
  min: "最小值",
  max: "最大值",
};

export const COMPUTED_RESULT_TYPES = ["number", "text", "checkbox", "date"] as const;
export type ComputedResultType = (typeof COMPUTED_RESULT_TYPES)[number];

export interface RelationConfig {
  databaseId: string;
  pairedPropertyId: string;
  owner: boolean;
}

export interface FormulaConfig {
  expression: string;
  resultType: ComputedResultType;
}

export interface RollupConfig {
  relationPropertyId: string;
  targetPropertyId: string;
  fn: RollupFunction;
  resultType: ComputedResultType;
}

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  deletedAt?: string | null;
  relation?: RelationConfig;
  formula?: FormulaConfig;
  rollup?: RollupConfig;
}

export function isComputedProperty(def: PropertyDefinition): boolean {
  return def.type === "formula" || def.type === "rollup";
}

export function effectiveType(def: PropertyDefinition): PropertyType {
  if (def.type === "formula") return def.formula?.resultType ?? "text";
  if (def.type === "rollup") return def.rollup?.resultType ?? "number";
  return def.type;
}

export function isStoredPropertyType(type: PropertyType): type is StoredPropertyType {
  return (STORED_PROPERTY_TYPES as readonly string[]).includes(type);
}

export type PropertyValue = string | number | boolean | string[];
export type RowProperties = Record<string, PropertyValue>;

export interface RelationCell {
  items: { id: string; title: string; icon: string | null }[];
  total: number;
}

export const FILTER_OPERATORS = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "is_not_empty",
  "is_checked",
  "is_not_checked",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FILTER_OPERATOR_LABEL: Record<FilterOperator, string> = {
  contains: "包含",
  not_contains: "不包含",
  equals: "等于",
  not_equals: "不等于",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  is_empty: "为空",
  is_not_empty: "不为空",
  is_checked: "已勾选",
  is_not_checked: "未勾选",
};

export interface ViewFilter {
  propertyId: string;
  operator: FilterOperator;
  value?: string | number | null;
}

export interface ViewFilterGroup {
  any: ViewFilter[];
}

export type ViewFilterEntry = ViewFilter | ViewFilterGroup;

export function isFilterGroup(entry: ViewFilterEntry): entry is ViewFilterGroup {
  return typeof entry === "object" && entry !== null && "any" in entry && Array.isArray(entry.any);
}

export function flatFilters(entries: readonly ViewFilterEntry[]): ViewFilter[] {
  return entries.flatMap((e) => (isFilterGroup(e) ? e.any : [e]));
}

export function retainFilters(
  entries: readonly ViewFilterEntry[],
  keep: (f: ViewFilter) => boolean,
): ViewFilterEntry[] {
  return entries.flatMap((entry): ViewFilterEntry[] => {
    if (!isFilterGroup(entry)) return keep(entry) ? [entry] : [];
    const any = entry.any.filter(keep);
    return any.length ? [{ any }] : [];
  });
}

export interface ViewSort {
  propertyId: string;
  direction: "asc" | "desc";
}

export const DATABASE_VIEW_TYPES = ["table", "board", "calendar", "gallery"] as const;
export type DatabaseViewType = (typeof DATABASE_VIEW_TYPES)[number];

export const VIEW_TYPE_LABEL: Record<DatabaseViewType, string> = {
  table: "表格",
  board: "看板",
  calendar: "日历",
  gallery: "画廊",
};

export const AGGREGATE_FUNCTIONS = ["count", "count_values", "count_empty", "sum", "avg", "min", "max"] as const;
export type AggregateFunction = (typeof AGGREGATE_FUNCTIONS)[number];

export const AGGREGATE_FUNCTION_LABEL: Record<AggregateFunction, string> = {
  count: "总数",
  count_values: "非空",
  count_empty: "为空",
  sum: "求和",
  avg: "均值",
  min: "最小",
  max: "最大",
};

export interface DatabaseView {
  id: string;
  name: string;
  type: DatabaseViewType;
  groupPropertyId?: string;
  datePropertyId?: string;
  filters: ViewFilterEntry[];
  sorts: ViewSort[];
  hiddenPropertyIds: string[];
  propertyOrder: string[];
  widths: Record<string, number>;
  aggregates?: Record<string, AggregateFunction>;
}

export interface PersonOption {
  id: string;
  name: string;
  avatarColor: string;
  title: string | null;
}

export interface DatabaseRow {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  sortOrder: number;
  properties: RowProperties;
  createdAt: string;
  updatedAt: string;
  relations?: Record<string, RelationCell>;
  computed?: Record<string, string | number | boolean>;
}

export interface TargetDatabaseSummary {
  id: string;
  title: string;
  icon: string | null;
  properties: PropertyDefinition[];
  rows: { id: string; title: string; icon: string | null }[];
}

export interface DatabasePayload {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceIcon: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  revision: number;
  properties: PropertyDefinition[];
  views: DatabaseView[];
  rows: DatabaseRow[];
  members: PersonOption[];
  canWrite: boolean;
  /** Referenced relation target databases for pickers and rollup config */
  relatedDatabases: Record<string, TargetDatabaseSummary>;
}

export interface SchemaHistorySummary {
  revision: number;
  kind: "create" | "update" | "relation" | "restore";
  sourceRevision: number | null;
  actor: { id: string; name: string; avatarColor: string } | null;
  createdAt: string;
  changes: string[];
  totalChanges: number;
}

export interface SchemaHistoryDetail extends SchemaHistorySummary {
  properties: PropertyDefinition[];
  views: DatabaseView[];
  diffFromCurrent: string[];
}
