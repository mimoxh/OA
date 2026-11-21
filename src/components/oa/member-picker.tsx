"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import type { MemberOption } from "@/lib/oa/types";
import { cn } from "@/lib/utils";

function MemberList({
  members,
  selected,
  onPick,
}: {
  members: MemberOption[];
  selected: string[];
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return members;
    return members.filter((m) =>
      [m.name, m.department ?? "", m.title ?? ""].some((s) => s.toLowerCase().includes(k)),
    );
  }, [members, q]);
  return (
    <div className="w-64">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索姓名、部门、职位…"
        className="mb-1 h-7 w-full rounded border border-line-strong px-2 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <div className="max-h-64 overflow-y-auto">
        {list.map((m) => (
          <button
            type="button"
            key={m.id}
            onClick={() => onPick(m.id)}
            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-hover"
          >
            <Avatar name={m.name} color={m.avatarColor} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{m.name}</span>
              <span className="block truncate text-[11px] text-ink-3">{[m.department, m.title].filter(Boolean).join(" · ") || "—"}</span>
            </span>
            {selected.includes(m.id) && <Check className="size-3.5 shrink-0 text-accent" />}
          </button>
        ))}
        {!list.length && <div className="py-4 text-center text-xs text-ink-3">没有匹配的成员</div>}
      </div>
    </div>
  );
}

const triggerCls =
  "flex h-8 w-full items-center gap-1.5 rounded-md border border-line-strong bg-white px-2.5 text-left text-sm text-ink transition-shadow " +
  "focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 disabled:bg-sidebar disabled:text-ink-2";

export function MemberSelect({
  members,
  value,
  onChange,
  placeholder = "选择成员",
  disabled,
  invalid,
  className,
}: {
  members: MemberOption[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = members.find((m) => m.id === value);
  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} className={cn(triggerCls, "pr-12", invalid && "border-danger")}>
            {cur ? (
              <>
                <Avatar name={cur.name} color={cur.avatarColor} size={18} />
                <span className="truncate">{cur.name}</span>
                {cur.department && <span className="truncate text-xs text-ink-3">{cur.department}</span>}
              </>
            ) : (
              <span className="text-ink-3">{placeholder}</span>
            )}
            <ChevronDown className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-1.5">
          <MemberList
            members={members}
            selected={value ? [value] : []}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {cur && !disabled && (
        <button
          type="button"
          aria-label="清除"
          onClick={() => onChange(null)}
          className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

export function MemberMultiSelect({
  members,
  value,
  onChange,
  disabled,
  addLabel = "添加成员",
  exclude = [],
}: {
  members: MemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  addLabel?: string;
  exclude?: string[];
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(members.map((m) => [m.id, m]));
  const pickable = members.filter((m) => !exclude.includes(m.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const m = byId.get(id);
        if (!m) return null;
        return (
          <span key={id} className="inline-flex h-6 items-center gap-1 rounded-full bg-hover pl-0.5 pr-1.5 text-[13px] text-ink">
            <Avatar name={m.name} color={m.avatarColor} size={20} />
            {m.name}
            {!disabled && (
              <button
                type="button"
                aria-label={`移除 ${m.name}`}
                onClick={() => onChange(value.filter((x) => x !== id))}
                className="rounded-full p-0.5 text-ink-3 hover:bg-active hover:text-ink"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-line-strong px-2 text-[13px] text-ink-2 hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3" />
              {addLabel}
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-1.5">
            <MemberList
              members={pickable}
              selected={value}
              onPick={(id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])}
            />
          </PopoverContent>
        </Popover>
      )}
      {disabled && !value.length && <span className="text-sm text-ink-3">—</span>}
    </div>
  );
}
