"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { useAction } from "@/components/ui/use-action";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

type SaveFn = (value: string) => Promise<ActionResult<unknown>>;

const shell = "-mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] items-center rounded px-1.5 text-left text-sm transition-colors";

function Empty({ text = "空" }: { text?: string }) {
  return <span className="text-ink-3">{text}</span>;
}

/** 点击即可编辑的文本属性（Notion 属性风格） */
export function InlineText({
  value,
  onSave,
  placeholder,
  readOnly,
  type = "text",
  multiline,
  display,
  className,
}: {
  value: string | null | undefined;
  onSave: SaveFn;
  placeholder?: string;
  readOnly?: boolean;
  type?: "text" | "number" | "email" | "tel";
  multiline?: boolean;
  display?: ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const { run, pending } = useAction();
  const current = value ?? "";
  const shown = display ?? (current ? current : <Empty text={placeholder} />);

  if (readOnly) return <div className={cn("min-h-7 py-1 text-sm", multiline && "whitespace-pre-wrap", className)}>{shown}</div>;

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v === current) return;
    run(() => onSave(v));
  };

  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onBlur: commit,
      className:
        "w-full rounded border border-accent bg-white px-1.5 text-sm text-ink outline-none ring-[3px] ring-accent/15 " +
        (multiline ? "min-h-20 py-1 leading-relaxed" : "h-7"),
    };
    return multiline ? (
      <textarea
        {...common}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        }}
      />
    ) : (
      <input
        {...common}
        type={type}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setDraft(current);
        setEditing(true);
      }}
      className={cn(shell, "hover:bg-hover", multiline && "items-start whitespace-pre-wrap py-1", pending && "opacity-60", className)}
    >
      {shown}
    </button>
  );
}

export type InlineOption = { value: string; label: ReactNode };

/** 下拉选择属性 */
export function InlineSelect({
  value,
  options,
  onSave,
  readOnly,
  placeholder,
  allowEmpty,
  emptyLabel = "清空",
  className,
}: {
  value: string | null | undefined;
  options: InlineOption[];
  onSave: SaveFn;
  readOnly?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const { run, pending } = useAction();
  const selected = options.find((o) => o.value === value);
  const shown = selected ? selected.label : <Empty text={placeholder} />;
  if (readOnly) return <div className={cn("flex min-h-7 items-center text-sm", className)}>{shown}</div>;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" disabled={pending} className={cn(shell, "hover:bg-hover data-[state=open]:bg-hover", pending && "opacity-60", className)}>
          {shown}
        </button>
      </MenuTrigger>
      <MenuContent className="max-h-80 overflow-y-auto">
        {allowEmpty && (
          <MenuItem onSelect={() => value && run(() => onSave(""))}>
            <span className="text-ink-3">{emptyLabel}</span>
          </MenuItem>
        )}
        {options.map((o) => (
          <MenuItem key={o.value} onSelect={() => o.value !== value && run(() => onSave(o.value))}>
            <span className="flex-1">{o.label}</span>
            {o.value === value && <Check className="size-3.5 text-ink-2" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** 日期属性（yyyy-MM-dd） */
export function InlineDate({
  value,
  onSave,
  readOnly,
  display,
  className,
  type = "date",
}: {
  value: string;
  onSave: SaveFn;
  readOnly?: boolean;
  display?: ReactNode;
  className?: string;
  type?: "date" | "datetime-local";
}) {
  const { run, pending } = useAction();
  if (readOnly) return <div className={cn("flex min-h-7 items-center text-sm", className)}>{display ?? (value || <Empty />)}</div>;
  return (
    <input
      type={type}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== value) run(() => onSave(v));
      }}
      className={cn(
        "-mx-1.5 h-7 rounded border border-transparent bg-transparent px-1.5 text-sm text-ink outline-none hover:bg-hover focus:border-accent focus:bg-white",
        !value && "text-ink-3",
        className,
      )}
    />
  );
}
