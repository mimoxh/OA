"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { RELATIVE_DATE_LABEL, RELATIVE_DATE_TOKENS } from "@/lib/docs/database/date-cells";
import { activeProperties, filterOperatorsFor, operatorNeedsValue } from "@/lib/docs/database/engine";
import {
  FILTER_OPERATOR_LABEL,
  PROPERTY_TYPE_LABEL,
  effectiveType,
  isFilterGroup,
  type DatabaseView,
  type FilterOperator,
  type PersonOption,
  type PropertyDefinition,
  type ViewFilter,
  type ViewSort,
} from "@/lib/docs/database/types";

export function FilterPanel({
  properties,
  view,
  members,
  onChange,
}: {
  properties: PropertyDefinition[];
  view: DatabaseView;
  members: PersonOption[];
  onChange: (nextFilters: DatabaseView["filters"]) => void;
}) {
  const active = activeProperties(properties);
  // Flatten top-level filters for straightforward editing; preserve any existing OR groups nicely
  const topFilters: ViewFilter[] = view.filters.flatMap((e) => (isFilterGroup(e) ? e.any : [e]));

  const updateAt = (idx: number, patch: Partial<ViewFilter>) => {
    const next = topFilters.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange(next);
  };

  const removeAt = (idx: number) => {
    onChange(topFilters.filter((_, i) => i !== idx));
  };

  const addFilter = () => {
    const first = active[0];
    if (!first) return;
    const ops = filterOperatorsFor(effectiveType(first));
    onChange([...topFilters, { propertyId: first.id, operator: ops[0], value: "" }]);
  };

  return (
    <div className="w-[460px] max-w-[92vw] space-y-2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink">筛选条件（全部满足）</span>
        {topFilters.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-ink-3 hover:text-ink">
            清空
          </button>
        )}
      </div>
      {topFilters.length === 0 ? (
        <div className="py-2 text-ink-3">暂无筛选条件</div>
      ) : (
        <div className="space-y-1.5">
          {topFilters.map((f, idx) => {
            const def = active.find((p) => p.id === f.propertyId) ?? active[0];
            const eff = def ? effectiveType(def) : "text";
            const ops = filterOperatorsFor(eff);
            const needsVal = operatorNeedsValue(f.operator);

            return (
              <div key={idx} className="flex items-center gap-1.5">
                <select
                  value={f.propertyId}
                  onChange={(e) => {
                    const nd = active.find((p) => p.id === e.target.value);
                    const nextOps = nd ? filterOperatorsFor(effectiveType(nd)) : ops;
                    updateAt(idx, { propertyId: e.target.value, operator: nextOps[0], value: "" });
                  }}
                  className="h-7 w-28 rounded border border-line bg-white px-1.5"
                >
                  {active.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={(e) => updateAt(idx, { operator: e.target.value as FilterOperator })}
                  className="h-7 w-24 rounded border border-line bg-white px-1.5"
                >
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {FILTER_OPERATOR_LABEL[op]}
                    </option>
                  ))}
                </select>
                {needsVal && def && (
                  <FilterValueInput
                    def={def}
                    members={members}
                    value={f.value ?? ""}
                    onChange={(v) => updateAt(idx, { value: v })}
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeAt(idx)}
                  className="ml-auto flex size-7 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-rose-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={addFilter}
        className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-accent hover:bg-accent-soft"
      >
        <Plus className="size-3.5" />
        添加筛选条件
      </button>
    </div>
  );
}

function FilterValueInput({
  def,
  members,
  value,
  onChange,
}: {
  def: PropertyDefinition;
  members: PersonOption[];
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  const eff = effectiveType(def);
  if (def.type === "select" || def.type === "multi_select") {
    return (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded border border-line bg-white px-1.5"
      >
        <option value="">选择选项...</option>
        {(def.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }
  if (def.type === "person") {
    return (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded border border-line bg-white px-1.5"
      >
        <option value="">选择成员...</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    );
  }
  if (eff === "date" || eff === "created_time" || eff === "updated_time") {
    const strVal = String(value);
    const isRel = strVal.startsWith("@");
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <select
          value={isRel ? strVal : "__custom"}
          onChange={(e) => {
            if (e.target.value === "__custom") onChange("");
            else onChange(e.target.value);
          }}
          className="h-7 w-24 rounded border border-line bg-white px-1"
        >
          <option value="__custom">指定日期</option>
          {RELATIVE_DATE_TOKENS.map((t) => (
            <option key={t} value={`@${t}`}>
              {RELATIVE_DATE_LABEL[t]}
            </option>
          ))}
        </select>
        {!isRel && (
          <input
            type="date"
            value={strVal}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded border border-line px-1.5"
          />
        )}
      </div>
    );
  }
  return (
    <input
      type={eff === "number" ? "number" : "text"}
      value={String(value)}
      onChange={(e) => onChange(eff === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
      placeholder="输入值..."
      className="h-7 min-w-0 flex-1 rounded border border-line px-2 outline-none focus:border-accent"
    />
  );
}

export function SortPanel({
  properties,
  view,
  onChange,
}: {
  properties: PropertyDefinition[];
  view: DatabaseView;
  onChange: (nextSorts: ViewSort[]) => void;
}) {
  const active = activeProperties(properties);

  const addSort = () => {
    const used = new Set(view.sorts.map((s) => s.propertyId));
    const candidate = active.find((p) => !used.has(p.id)) ?? active[0];
    if (!candidate) return;
    onChange([...view.sorts, { propertyId: candidate.id, direction: "asc" }]);
  };

  return (
    <div className="w-80 space-y-2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink">排序规则（空值始终排在末尾）</span>
        {view.sorts.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-ink-3 hover:text-ink">
            清空
          </button>
        )}
      </div>
      {view.sorts.length === 0 ? (
        <div className="py-2 text-ink-3">当前按手动顺序排列（可拖拽行调整顺序）</div>
      ) : (
        <div className="space-y-1.5">
          {view.sorts.map((s, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <select
                value={s.propertyId}
                onChange={(e) =>
                  onChange(view.sorts.map((item, i) => (i === idx ? { ...item, propertyId: e.target.value } : item)))
                }
                className="h-7 flex-1 rounded border border-line bg-white px-1.5"
              >
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={s.direction}
                onChange={(e) =>
                  onChange(
                    view.sorts.map((item, i) =>
                      i === idx ? { ...item, direction: e.target.value as "asc" | "desc" } : item,
                    ),
                  )
                }
                className="h-7 w-20 rounded border border-line bg-white px-1.5"
              >
                <option value="asc">升序 ↑</option>
                <option value="desc">降序 ↓</option>
              </select>
              <button
                type="button"
                onClick={() => onChange(view.sorts.filter((_, i) => i !== idx))}
                className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-rose-600"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addSort}
        className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-accent hover:bg-accent-soft"
      >
        <Plus className="size-3.5" />
        添加排序
      </button>
    </div>
  );
}

export function FieldsPanel({
  properties,
  view,
  canWrite,
  onToggleHidden,
  onMoveOrder,
  onRestoreProperty,
  onAddProperty,
}: {
  properties: PropertyDefinition[];
  view: DatabaseView;
  canWrite: boolean;
  onToggleHidden: (propertyId: string) => void;
  onMoveOrder: (propertyId: string, dir: -1 | 1) => void;
  onRestoreProperty: (propertyId: string) => void;
  onAddProperty: () => void;
}) {
  const active = activeProperties(properties).filter((p) => p.type !== "title");
  const deleted = properties.filter((p) => !!p.deletedAt);
  const hiddenSet = new Set(view.hiddenPropertyIds);

  const ordered = [
    ...view.propertyOrder
      .map((id) => active.find((p) => p.id === id))
      .filter((x): x is PropertyDefinition => !!x),
    ...active.filter((p) => !view.propertyOrder.includes(p.id)),
  ];

  return (
    <div className="w-72 space-y-2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink">字段显示与顺序</span>
        {canWrite && (
          <button
            type="button"
            onClick={onAddProperty}
            className="inline-flex items-center gap-0.5 text-accent hover:underline"
          >
            <Plus className="size-3" />
            新增
          </button>
        )}
      </div>
      <div className="max-h-60 space-y-1 overflow-y-auto">
        {ordered.map((p, idx) => {
          const hidden = hiddenSet.has(p.id);
          return (
            <div key={p.id} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-hover/70">
              <span className="min-w-0 flex-1 truncate text-ink">
                {p.name}
                <span className="ml-1 text-[10px] text-ink-3">{PROPERTY_TYPE_LABEL[p.type]}</span>
              </span>
              {canWrite && (
                <>
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMoveOrder(p.id, -1)}
                    className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink disabled:opacity-30"
                    title="上移"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === ordered.length - 1}
                    onClick={() => onMoveOrder(p.id, 1)}
                    className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink disabled:opacity-30"
                    title="下移"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => onToggleHidden(p.id)}
                className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink disabled:opacity-40"
                title={hidden ? "显示该列" : "隐藏该列"}
              >
                {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5 text-accent" />}
              </button>
            </div>
          );
        })}
      </div>

      {deleted.length > 0 && (
        <div className="border-t border-line pt-2">
          <div className="mb-1 text-[11px] font-medium text-ink-3">已删除字段（可恢复，历史行数据仍在）</div>
          <div className="space-y-1">
            {deleted.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded bg-sidebar px-2 py-1">
                <span className="truncate text-ink-2">
                  {p.name}（{PROPERTY_TYPE_LABEL[p.type]}）
                </span>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => onRestoreProperty(p.id)}
                    className="inline-flex shrink-0 items-center gap-0.5 text-accent hover:underline"
                  >
                    <RotateCcw className="size-3" />
                    恢复
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
