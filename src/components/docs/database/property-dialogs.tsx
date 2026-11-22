"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { makeId } from "@/lib/docs/database/engine";
import {
  FORMULA_FUNCTIONS_HELP,
  formulaIdsToNames,
  formulaNamesToIds,
  validateFormulaSyntax,
} from "@/lib/docs/database/formula";
import {
  COMPUTED_RESULT_TYPES,
  OPTION_COLORS,
  OPTION_COLOR_STYLE,
  PROPERTY_TYPE_LABEL,
  ROLLUP_FUNCTIONS,
  ROLLUP_FUNCTION_LABEL,
  type ComputedResultType,
  type OptionColor,
  type PropertyDefinition,
  type PropertyType,
  type RollupFunction,
  type SelectOption,
  type TargetDatabaseSummary,
} from "@/lib/docs/database/types";
import { PropertyTypeIcon } from "./cells";

const CREATABLE_TYPES: PropertyType[] = [
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
];

const RESULT_TYPE_LABEL: Record<ComputedResultType, string> = {
  number: "数字",
  text: "文本",
  checkbox: "复选框",
  date: "日期",
};

interface AvailableDatabase {
  id: string;
  title: string;
  icon: string | null;
  spaceName: string;
}

export function PropertyEditorDialog({
  open,
  onOpenChange,
  databaseId,
  properties,
  editingProperty,
  relatedDatabases,
  onSaveProperty,
  onCreateRelation,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  databaseId: string;
  properties: PropertyDefinition[];
  editingProperty: PropertyDefinition | null;
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  onSaveProperty: (prop: PropertyDefinition, isNew: boolean) => Promise<void>;
  onCreateRelation: (targetDatabaseId: string, name: string, pairedName: string) => Promise<void>;
}) {
  const isNew = !editingProperty;
  const [name, setName] = useState(editingProperty?.name ?? "");
  const [type, setType] = useState<PropertyType>(editingProperty?.type ?? "text");
  const [options, setOptions] = useState<SelectOption[]>(editingProperty?.options ?? []);
  const [newOptName, setNewOptName] = useState("");
  const [newOptColor, setNewOptColor] = useState<OptionColor>("blue");

  // Formula config
  const [formulaText, setFormulaText] = useState(() =>
    editingProperty?.formula ? formulaIdsToNames(editingProperty.formula.expression, properties) : "",
  );
  const [formulaResultType, setFormulaResultType] = useState<ComputedResultType>(
    editingProperty?.formula?.resultType ?? "number",
  );

  // Rollup config
  const relationProps = properties.filter((p) => !p.deletedAt && p.type === "relation" && p.relation);
  const [rollupRelId, setRollupRelId] = useState(
    editingProperty?.rollup?.relationPropertyId ?? relationProps[0]?.id ?? "",
  );
  const selectedRel = relationProps.find((p) => p.id === rollupRelId);
  const targetDbForRollup = selectedRel?.relation ? relatedDatabases[selectedRel.relation.databaseId] : undefined;
  const targetPropsForRollup = (targetDbForRollup?.properties ?? []).filter((p) => !p.deletedAt);

  const [rollupTargetPropId, setRollupTargetPropId] = useState(
    editingProperty?.rollup?.targetPropertyId ?? targetPropsForRollup[0]?.id ?? "",
  );
  const [rollupFn, setRollupFn] = useState<RollupFunction>(editingProperty?.rollup?.fn ?? "count");
  const [rollupResultType, setRollupResultType] = useState<ComputedResultType>(
    editingProperty?.rollup?.resultType ?? "number",
  );

  // Relation creation config (only for new relation)
  const [availableDbs, setAvailableDbs] = useState<AvailableDatabase[]>([]);
  const [relTargetDbId, setRelTargetDbId] = useState("");
  const [relPairedName, setRelPairedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isNew || type !== "relation") return;
    let cancelled = false;
    fetch("/api/docs/databases")
      .then((r) => r.json())
      .then((data: { databases?: AvailableDatabase[] }) => {
        if (cancelled) return;
        const list = data.databases ?? [];
        setAvailableDbs(list);
        if (list.length > 0) {
          setRelTargetDbId((prev) => prev || list.find((d) => d.id !== databaseId)?.id || list[0].id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, isNew, type, databaseId]);

  const activeFields = properties.filter((p) => !p.deletedAt && p.id !== editingProperty?.id);
  const formulaSyntaxError = type === "formula" && formulaText.trim() ? validateFormulaSyntax(formulaText) : null;

  const addOption = () => {
    const trimmed = newOptName.trim();
    if (!trimmed) return;
    setOptions((prev) => [...prev, { id: makeId("opt"), name: trimmed, color: newOptColor }]);
    setNewOptName("");
  };

  const handleSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入字段名称");
      return;
    }

    setSaving(true);
    try {
      if (isNew && type === "relation") {
        if (!relTargetDbId) {
          setError("请选择要关联的目标多维表格");
          setSaving(false);
          return;
        }
        await onCreateRelation(relTargetDbId, trimmedName, relPairedName.trim());
        onOpenChange(false);
        return;
      }

      const nextProp: PropertyDefinition = {
        ...(editingProperty ?? { id: makeId("prop"), name: trimmedName, type }),
        name: trimmedName,
        type: editingProperty?.type === "title" ? "title" : editingProperty?.type === "relation" ? "relation" : type,
        options:
          type === "select" || type === "multi_select"
            ? options
            : editingProperty?.options,
      };

      if (nextProp.type === "formula") {
        const storedExpr = formulaNamesToIds(formulaText.trim(), properties);
        const err = validateFormulaSyntax(storedExpr);
        if (err) {
          setError(err);
          setSaving(false);
          return;
        }
        nextProp.formula = { expression: storedExpr, resultType: formulaResultType };
      }

      if (nextProp.type === "rollup") {
        if (!rollupRelId) {
          setError("请先在当前表格中创建一个「关联」字段");
          setSaving(false);
          return;
        }
        const tPropId = rollupTargetPropId || targetPropsForRollup[0]?.id || "";
        if (!tPropId && rollupFn !== "count") {
          setError("请选择目标表格的汇总字段");
          setSaving(false);
          return;
        }
        nextProp.rollup = {
          relationPropertyId: rollupRelId,
          targetPropertyId: tPropId,
          fn: rollupFn,
          resultType: rollupResultType,
        };
      }

      await onSaveProperty(nextProp, isNew);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const canChangeType = isNew || (editingProperty.type !== "title" && editingProperty.type !== "relation");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isNew ? "新增字段" : `编辑字段「${editingProperty.name}」`}
        className="max-w-lg"
        footer={
          <>
            <Button variant="default" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSubmit}>
              保存字段
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">字段名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：优先级、预算、截止日期"
              className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </div>

          {canChangeType && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-2">字段类型</label>
              <div className="grid grid-cols-3 gap-1.5">
                {CREATABLE_TYPES.filter((t) => (isNew ? true : t !== "relation")).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                      type === t
                        ? "border-accent bg-accent-soft/70 font-medium text-accent"
                        : "border-line bg-white text-ink-2 hover:bg-hover",
                    )}
                  >
                    <PropertyTypeIcon type={t} className="size-3.5 shrink-0" />
                    <span className="truncate">{PROPERTY_TYPE_LABEL[t]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Select / Multi-Select Options Editor */}
          {(type === "select" || type === "multi_select") && (
            <div className="space-y-2 rounded-lg border border-line bg-sidebar/50 p-3">
              <div className="text-xs font-medium text-ink-2">选项配置（切换类型或删除选项不丢失历史行值）</div>
              <div className="space-y-1.5">
                {options.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-1.5">
                    <select
                      value={opt.color}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, color: e.target.value as OptionColor } : o)),
                        )
                      }
                      className="h-7 rounded border border-line bg-white px-1.5 text-xs"
                    >
                      {OPTION_COLORS.map((c) => (
                        <option key={c} value={c}>
                          {OPTION_COLOR_STYLE[c].label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={opt.name}
                      onChange={(e) =>
                        setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, name: e.target.value } : o)))
                      }
                      className="h-7 flex-1 rounded border border-line bg-white px-2 text-xs text-ink outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                      className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-rose-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <select
                  value={newOptColor}
                  onChange={(e) => setNewOptColor(e.target.value as OptionColor)}
                  className="h-7 rounded border border-line bg-white px-1.5 text-xs"
                >
                  {OPTION_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {OPTION_COLOR_STYLE[c].label}
                    </option>
                  ))}
                </select>
                <input
                  value={newOptName}
                  onChange={(e) => setNewOptName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOption();
                    }
                  }}
                  placeholder="输入新选项名，按回车添加"
                  className="h-7 flex-1 rounded border border-line bg-white px-2 text-xs outline-none focus:border-accent"
                />
                <Button size="sm" variant="default" onClick={addOption}>
                  <Plus className="size-3.5" />
                  添加
                </Button>
              </div>
            </div>
          )}

          {/* Relation creator */}
          {isNew && type === "relation" && (
            <div className="space-y-3 rounded-lg border border-line bg-sidebar/50 p-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">目标多维表格（建立双向关联）</label>
                <select
                  value={relTargetDbId}
                  onChange={(e) => setRelTargetDbId(e.target.value)}
                  className="h-8 w-full rounded border border-line bg-white px-2 text-xs text-ink"
                >
                  {availableDbs.length === 0 && <option value="">加载中...</option>}
                  {availableDbs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}（{d.spaceName}）{d.id === databaseId ? " [当前表格自关联]" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">对方表格中的反向字段名（可选）</label>
                <input
                  value={relPairedName}
                  onChange={(e) => setRelPairedName(e.target.value)}
                  placeholder="留空则默认使用当前表格名称"
                  className="h-8 w-full rounded border border-line bg-white px-2.5 text-xs text-ink outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {/* Formula Editor */}
          {type === "formula" && (
            <div className="space-y-2.5 rounded-lg border border-line bg-sidebar/50 p-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-ink-2">公式表达式</label>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-ink-3">返回类型：</span>
                  <select
                    value={formulaResultType}
                    onChange={(e) => setFormulaResultType(e.target.value as ComputedResultType)}
                    className="h-6 rounded border border-line bg-white px-1.5 text-xs"
                  >
                    {COMPUTED_RESULT_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {RESULT_TYPE_LABEL[rt]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea
                rows={3}
                value={formulaText}
                onChange={(e) => setFormulaText(e.target.value)}
                placeholder={'例如：prop("单价") * prop("数量") 或 if(prop("完成"), "已完成", "进行中")'}
                className="w-full rounded border border-line bg-white p-2 font-mono text-xs text-ink outline-none focus:border-accent"
              />
              {formulaSyntaxError && <div className="text-xs text-rose-600">{formulaSyntaxError}</div>}
              <div>
                <div className="mb-1 text-[11px] text-ink-3">点击插入字段引用（存储按 ID 绑定，改名不失效）：</div>
                <div className="flex flex-wrap gap-1">
                  {activeFields.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFormulaText((prev) => `${prev}${prev ? " " : ""}prop("${f.name}")`)}
                      className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
              <details className="text-[11px] text-ink-3">
                <summary className="cursor-pointer hover:text-ink-2">查看内置函数参考</summary>
                <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded border border-line bg-white p-2">
                  {FORMULA_FUNCTIONS_HELP.map((h) => (
                    <div key={h.name} className="flex justify-between gap-2">
                      <code className="text-accent">{h.sig}</code>
                      <span>{h.desc}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* Rollup Editor */}
          {type === "rollup" && (
            <div className="space-y-2.5 rounded-lg border border-line bg-sidebar/50 p-3 text-xs">
              {relationProps.length === 0 ? (
                <div className="text-amber-700">当前表格尚无「关联」字段。请先新建一个关联字段，再配置汇总。</div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block font-medium text-ink-2">关联字段</label>
                    <select
                      value={rollupRelId}
                      onChange={(e) => {
                        setRollupRelId(e.target.value);
                        const rel = relationProps.find((p) => p.id === e.target.value);
                        const tdb = rel?.relation ? relatedDatabases[rel.relation.databaseId] : undefined;
                        setRollupTargetPropId(tdb?.properties.find((p) => !p.deletedAt)?.id ?? "");
                      }}
                      className="h-8 w-full rounded border border-line bg-white px-2"
                    >
                      {relationProps.map((rp) => (
                        <option key={rp.id} value={rp.id}>
                          {rp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-ink-2">目标表格字段</label>
                    <select
                      value={rollupTargetPropId}
                      onChange={(e) => setRollupTargetPropId(e.target.value)}
                      className="h-8 w-full rounded border border-line bg-white px-2"
                    >
                      {targetPropsForRollup.map((tp) => (
                        <option key={tp.id} value={tp.id}>
                          {tp.name}（{PROPERTY_TYPE_LABEL[tp.type]}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-medium text-ink-2">汇总方式</label>
                      <select
                        value={rollupFn}
                        onChange={(e) => setRollupFn(e.target.value as RollupFunction)}
                        className="h-8 w-full rounded border border-line bg-white px-2"
                      >
                        {ROLLUP_FUNCTIONS.map((fn) => (
                          <option key={fn} value={fn}>
                            {ROLLUP_FUNCTION_LABEL[fn]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block font-medium text-ink-2">结果类型</label>
                      <select
                        value={rollupResultType}
                        onChange={(e) => setRollupResultType(e.target.value as ComputedResultType)}
                        className="h-8 w-full rounded border border-line bg-white px-2"
                      >
                        {COMPUTED_RESULT_TYPES.map((rt) => (
                          <option key={rt} value={rt}>
                            {RESULT_TYPE_LABEL[rt]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
