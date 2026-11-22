"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Calendar,
  Check,
  CheckSquare,
  Clock,
  ExternalLink,
  FunctionSquare,
  Hash,
  Link2,
  ListChecks,
  Plus,
  Sigma,
  Tag,
  Type,
  User as UserIcon,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { displayDateCell, formatDateCell, localDay, parseDateCell } from "@/lib/docs/database/date-cells";
import { cellValue } from "@/lib/docs/database/engine";
import {
  OPTION_COLOR_STYLE,
  effectiveType,
  type DatabaseRow,
  type OptionColor,
  type PersonOption,
  type PropertyDefinition,
  type PropertyType,
  type PropertyValue,
  type TargetDatabaseSummary,
} from "@/lib/docs/database/types";

export function PropertyTypeIcon({ type, className = "size-3.5" }: { type: PropertyType; className?: string }) {
  switch (type) {
    case "title":
    case "text":
      return <Type className={className} />;
    case "number":
      return <Hash className={className} />;
    case "select":
      return <Tag className={className} />;
    case "multi_select":
      return <ListChecks className={className} />;
    case "date":
      return <Calendar className={className} />;
    case "checkbox":
      return <CheckSquare className={className} />;
    case "url":
      return <ExternalLink className={className} />;
    case "person":
      return <UserIcon className={className} />;
    case "created_time":
    case "updated_time":
      return <Clock className={className} />;
    case "relation":
      return <Link2 className={className} />;
    case "formula":
      return <FunctionSquare className={className} />;
    case "rollup":
      return <Sigma className={className} />;
  }
}

export function OptionPill({ name, color, onRemove }: { name: string; color: OptionColor; onRemove?: () => void }) {
  const st = OPTION_COLOR_STYLE[color] ?? OPTION_COLOR_STYLE.default;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium leading-tight", st.badge)}>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded hover:bg-black/10"
          aria-label="移除选项"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export interface CellEditorProps {
  row: DatabaseRow;
  def: PropertyDefinition;
  members: PersonOption[];
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  canWrite: boolean;
  compact?: boolean;
  onUpdateTitle?: (title: string) => void;
  onUpdateProperty: (propertyId: string, value: PropertyValue | null) => void;
  onUpdateRelation: (propertyId: string, add: string[], remove: string[]) => void;
  onOpenRow?: (rowId: string) => void;
}

export function DatabaseCell({
  row,
  def,
  members,
  relatedDatabases,
  canWrite,
  compact,
  onUpdateTitle,
  onUpdateProperty,
  onUpdateRelation,
  onOpenRow,
}: CellEditorProps) {
  const [editing, setEditing] = useState(false);
  const val = cellValue(row, def);

  // Title cell
  if (def.type === "title") {
    if (editing && canWrite && onUpdateTitle) {
      return (
        <InlineTextInput
          initial={row.title}
          placeholder="无标题"
          onCommit={(v) => {
            setEditing(false);
            if (v !== row.title) onUpdateTitle(v);
          }}
          onCancel={() => setEditing(false)}
        />
      );
    }
    return (
      <div className="group/title flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => (canWrite && onUpdateTitle ? setEditing(true) : onOpenRow?.(row.id))}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {row.icon && <span className="shrink-0 text-sm leading-none">{row.icon}</span>}
          <span className={cn("truncate text-[13px] font-medium", row.title ? "text-ink" : "text-ink-3")}>
            {row.title || "无标题"}
          </span>
        </button>
        {onOpenRow && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenRow(row.id);
            }}
            className="shrink-0 rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-ink-2 opacity-0 shadow-xs transition-opacity hover:bg-hover hover:text-ink group-hover/title:opacity-100"
          >
            打开
          </button>
        )}
      </div>
    );
  }

  // Checkbox cell (single click toggle)
  if (def.type === "checkbox") {
    const checked = val === true;
    return (
      <button
        type="button"
        disabled={!canWrite}
        onClick={() => canWrite && onUpdateProperty(def.id, !checked)}
        className={cn(
          "flex size-4 items-center justify-center rounded border transition-colors",
          checked ? "border-accent bg-accent text-white" : "border-line-strong bg-white hover:border-accent",
          !canWrite && "cursor-default opacity-70",
        )}
        aria-label={checked ? "取消勾选" : "勾选"}
      >
        {checked && <Check className="size-3 stroke-[2.5]" />}
      </button>
    );
  }

  // Read-only timestamps
  if (def.type === "created_time" || def.type === "updated_time") {
    const d = new Date(String(val ?? ""));
    const label = Number.isNaN(d.getTime()) ? "" : localDay(d);
    return <span className="text-xs text-ink-3">{label}</span>;
  }

  // Read-only computed (formula & rollup)
  if (def.type === "formula" || def.type === "rollup") {
    const eff = effectiveType(def);
    if (val === undefined) return <span className="text-xs text-ink-3">—</span>;
    if (eff === "checkbox") {
      return (
        <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs", val ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
          {val ? "是" : "否"}
        </span>
      );
    }
    if (eff === "date") {
      return <span className="text-xs text-ink-2">{displayDateCell(val)}</span>;
    }
    if (eff === "number" && typeof val === "number") {
      return <span className="font-mono text-xs text-ink">{val.toLocaleString("zh-CN", { maximumFractionDigits: 4 })}</span>;
    }
    return <span className="truncate text-xs text-ink">{String(val)}</span>;
  }

  // Text / URL / Number
  if (def.type === "text" || def.type === "url" || def.type === "number") {
    if (editing && canWrite) {
      return (
        <InlineTextInput
          initial={val !== undefined ? String(val) : ""}
          type={def.type === "number" ? "number" : "text"}
          placeholder={def.type === "url" ? "https://..." : ""}
          onCommit={(raw) => {
            setEditing(false);
            const trimmed = raw.trim();
            if (!trimmed) {
              if (val !== undefined) onUpdateProperty(def.id, null);
              return;
            }
            if (def.type === "number") {
              const n = Number(trimmed);
              if (Number.isFinite(n) && n !== val) onUpdateProperty(def.id, n);
            } else if (trimmed !== val) {
              onUpdateProperty(def.id, trimmed);
            }
          }}
          onCancel={() => setEditing(false)}
        />
      );
    }
    if (def.type === "url" && typeof val === "string") {
      const href = val.includes("://") ? val : `https://${val}`;
      return (
        <div
          onClick={() => canWrite && setEditing(true)}
          className={cn("flex min-h-[24px] min-w-0 items-center gap-1", canWrite && "cursor-text")}
        >
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="truncate text-xs text-accent underline-offset-2 hover:underline"
          >
            {val}
          </a>
        </div>
      );
    }
    if (def.type === "number" && typeof val === "number") {
      return (
        <button
          type="button"
          disabled={!canWrite}
          onClick={() => canWrite && setEditing(true)}
          className="flex min-h-[24px] w-full items-center justify-end font-mono text-xs text-ink"
        >
          {val.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}
        </button>
      );
    }
    return (
      <button
        type="button"
        disabled={!canWrite}
        onClick={() => canWrite && setEditing(true)}
        className={cn("flex min-h-[24px] w-full items-center text-left text-xs", val ? "text-ink" : "text-ink-3")}
      >
        <span className="truncate">{val !== undefined ? String(val) : compact ? "" : "—"}</span>
      </button>
    );
  }

  // Date cell (supports start + optional end date)
  if (def.type === "date") {
    const parsed = parseDateCell(val);
    return (
      <PopoverCell
        open={editing}
        onOpenChange={(v) => canWrite && setEditing(v)}
        trigger={
          <span className={cn("block min-h-[24px] leading-6 text-xs", parsed ? "text-ink" : "text-ink-3")}>
            {parsed ? displayDateCell(val) : compact ? "" : "—"}
          </span>
        }
      >
        <DateRangeEditor
          initialStart={parsed?.start ?? ""}
          initialEnd={parsed?.end ?? ""}
          onSave={(next) => {
            setEditing(false);
            onUpdateProperty(def.id, next);
          }}
        />
      </PopoverCell>
    );
  }

  // Select / Multi-Select cell
  if (def.type === "select" || def.type === "multi_select") {
    const options = def.options ?? [];
    const selectedIds = def.type === "select" ? (typeof val === "string" ? [val] : []) : Array.isArray(val) ? val : [];
    const selectedOpts = selectedIds
      .map((id) => options.find((o) => o.id === id))
      .filter((x): x is NonNullable<typeof x> => !!x);

    return (
      <PopoverCell
        open={editing}
        onOpenChange={(v) => canWrite && setEditing(v)}
        trigger={
          <div className="flex min-h-[24px] flex-wrap items-center gap-1">
            {selectedOpts.length > 0 ? (
              selectedOpts.map((o) => <OptionPill key={o.id} name={o.name} color={o.color} />)
            ) : (
              <span className="text-xs text-ink-3">{compact ? "" : "—"}</span>
            )}
          </div>
        }
      >
        <div className="w-52 space-y-1 p-1.5">
          {options.length === 0 && <div className="px-2 py-2 text-xs text-ink-3">暂无选项，请在列菜单中添加</div>}
          {options.map((opt) => {
            const active = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  if (def.type === "select") {
                    onUpdateProperty(def.id, active ? null : opt.id);
                    setEditing(false);
                  } else {
                    const next = active ? selectedIds.filter((id) => id !== opt.id) : [...selectedIds, opt.id];
                    onUpdateProperty(def.id, next.length ? next : null);
                  }
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-hover"
              >
                <OptionPill name={opt.name} color={opt.color} />
                {active && <Check className="size-3.5 text-accent" />}
              </button>
            );
          })}
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onUpdateProperty(def.id, null);
                setEditing(false);
              }}
              className="mt-1 w-full rounded border-t border-line px-2 py-1 text-left text-xs text-ink-3 hover:bg-hover hover:text-ink"
            >
              清空选择
            </button>
          )}
        </div>
      </PopoverCell>
    );
  }

  // Person cell (OA space members)
  if (def.type === "person") {
    const member = typeof val === "string" ? members.find((m) => m.id === val) : undefined;
    return (
      <PopoverCell
        open={editing}
        onOpenChange={(v) => canWrite && setEditing(v)}
        trigger={
          <div className="flex min-h-[24px] items-center gap-1.5">
            {member ? (
              <>
                <Avatar name={member.name} color={member.avatarColor} size={18} />
                <span className="truncate text-xs text-ink">{member.name}</span>
              </>
            ) : (
              <span className="text-xs text-ink-3">{compact ? "" : "—"}</span>
            )}
          </div>
        }
      >
        <div className="max-h-60 w-52 overflow-y-auto p-1.5">
          {members.map((m) => {
            const active = val === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onUpdateProperty(def.id, active ? null : m.id);
                  setEditing(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover"
              >
                <Avatar name={m.name} color={m.avatarColor} size={18} />
                <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                {active && <Check className="size-3.5 text-accent" />}
              </button>
            );
          })}
          {member && (
            <button
              type="button"
              onClick={() => {
                onUpdateProperty(def.id, null);
                setEditing(false);
              }}
              className="mt-1 w-full border-t border-line px-2 py-1 text-left text-xs text-ink-3 hover:bg-hover hover:text-ink"
            >
              取消分配
            </button>
          )}
        </div>
      </PopoverCell>
    );
  }

  // Relation cell
  if (def.type === "relation") {
    const cell = row.relations?.[def.id];
    const linked = cell?.items ?? [];
    const targetDb = def.relation ? relatedDatabases[def.relation.databaseId] : undefined;
    const linkedIds = new Set(linked.map((x) => x.id));

    return (
      <PopoverCell
        open={editing}
        onOpenChange={(v) => canWrite && setEditing(v)}
        trigger={
          <div className="flex min-h-[24px] flex-wrap items-center gap-1">
            {linked.length > 0 ? (
              linked.map((item) => (
                <Link
                  key={item.id}
                  href={`/docs/${item.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex max-w-[160px] items-center gap-1 rounded border border-accent/25 bg-accent-soft/70 px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft"
                >
                  <span className="truncate">{item.title || "无标题"}</span>
                </Link>
              ))
            ) : (
              <span className="text-xs text-ink-3">{compact ? "" : "—"}</span>
            )}
          </div>
        }
      >
        <RelationPicker
          targetDb={targetDb}
          linkedIds={linkedIds}
          onToggle={(targetRowId, isLinked) => {
            onUpdateRelation(def.id, isLinked ? [] : [targetRowId], isLinked ? [targetRowId] : []);
          }}
        />
      </PopoverCell>
    );
  }

  return null;
}

function InlineTextInput({
  initial,
  type = "text",
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  type?: "text" | "number";
  placeholder?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <input
      autoFocus
      type={type}
      value={val}
      placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(val);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-6 w-full rounded border border-accent bg-white px-1.5 text-xs text-ink outline-none ring-2 ring-accent/15"
    />
  );
}

function PopoverCell({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenChange(!open);
          }
        }}
        className="w-full cursor-pointer rounded px-0.5 hover:bg-hover/60"
      >
        {trigger}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => onOpenChange(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 rounded-lg border border-line bg-white shadow-lg">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function DateRangeEditor({
  initialStart,
  initialEnd,
  onSave,
}: {
  initialStart: string;
  initialEnd: string;
  onSave: (value: string | null) => void;
}) {
  const [start, setStart] = useState(initialStart);
  const [hasEnd, setHasEnd] = useState(Boolean(initialEnd));
  const [end, setEnd] = useState(initialEnd);

  return (
    <div className="w-60 space-y-2 p-2.5 text-xs">
      <div>
        <label className="mb-1 block text-[11px] text-ink-3">开始日期</label>
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-7 w-full rounded border border-line px-2 text-xs text-ink outline-none focus:border-accent"
        />
      </div>
      <label className="flex items-center gap-1.5 text-ink-2">
        <input
          type="checkbox"
          checked={hasEnd}
          onChange={(e) => {
            setHasEnd(e.target.checked);
            if (!e.target.checked) setEnd("");
          }}
        />
        包含结束日期
      </label>
      {hasEnd && (
        <div>
          <label className="mb-1 block text-[11px] text-ink-3">结束日期</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="h-7 w-full rounded border border-line px-2 text-xs text-ink outline-none focus:border-accent"
          />
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => onSave(null)}
          className="rounded px-2 py-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          清空
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              const t = localDay(new Date());
              setStart(t);
              onSave(hasEnd && end ? formatDateCell(t, end) : t);
            }}
            className="rounded border border-line px-2 py-1 text-ink-2 hover:bg-hover"
          >
            今天
          </button>
          <button
            type="button"
            onClick={() => onSave(start ? formatDateCell(start, hasEnd ? end : null) : null)}
            className="rounded bg-accent px-2.5 py-1 font-medium text-white hover:opacity-90"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

function RelationPicker({
  targetDb,
  linkedIds,
  onToggle,
}: {
  targetDb?: TargetDatabaseSummary;
  linkedIds: ReadonlySet<string>;
  onToggle: (rowId: string, currentlyLinked: boolean) => void;
}) {
  const [q, setQ] = useState("");
  if (!targetDb) {
    return <div className="w-56 p-3 text-xs text-ink-3">关联的目标表格不可访问或已删除</div>;
  }
  const needle = q.trim().toLowerCase();
  const filtered = targetDb.rows.filter((r) => !needle || (r.title || "无标题").toLowerCase().includes(needle));
  return (
    <div className="w-64 p-2">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
        <span className="truncate">关联：{targetDb.title || "未命名表格"}</span>
        <span>{linkedIds.size} 已选</span>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索记录..."
        className="mb-1.5 h-7 w-full rounded border border-line px-2 text-xs outline-none focus:border-accent"
      />
      <div className="max-h-52 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-3 text-center text-xs text-ink-3">没有匹配的记录</div>
        ) : (
          filtered.map((r) => {
            const active = linkedIds.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onToggle(r.id, active)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-hover"
              >
                <span className="shrink-0">{r.icon || "📄"}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.title || "无标题"}</span>
                {active ? <Check className="size-3.5 text-accent" /> : <Plus className="size-3 text-ink-3" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
