"use client";

import type { ReactNode } from "react";
import type { FormField } from "@/lib/services/approval";
import type { FormValues } from "@/lib/oa/form";
import type { MemberOption } from "@/lib/oa/types";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { MemberSelect } from "@/components/oa/member-picker";
import { cn } from "@/lib/utils";

export function FieldControl({
  field,
  value,
  onChange,
  members,
  invalid,
  disabled,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  members: MemberOption[];
  invalid?: boolean;
  disabled?: boolean;
}) {
  const cls = cn(invalid && "border-danger focus:border-danger focus:ring-danger/15");
  const placeholder = field.placeholder || (field.type === "select" ? undefined : `请输入${field.label}`);
  switch (field.type) {
    case "textarea":
      return (
        <Textarea rows={4} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
      );
    case "number":
      return (
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn("max-w-60", cls)}
        />
      );
    case "date":
      return <Input type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn("max-w-60", cls)} />;
    case "select":
      return (
        <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn("max-w-60", cls)}>
          <option value="">请选择</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "user":
      return (
        <MemberSelect
          members={members}
          value={value || null}
          onChange={(id) => onChange(id ?? "")}
          disabled={disabled}
          invalid={invalid}
          className="max-w-60"
        />
      );
    default:
      return <Input value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />;
  }
}

export function DynamicFormFields({
  fields,
  values,
  onChange,
  errors = {},
  members,
  disabled,
  empty,
}: {
  fields: FormField[];
  values: FormValues;
  onChange: (name: string, v: string) => void;
  errors?: Record<string, string>;
  members: MemberOption[];
  disabled?: boolean;
  empty?: ReactNode;
}) {
  if (!fields.length) return <>{empty ?? <p className="text-sm text-ink-3">该流程没有表单字段</p>}</>;
  return (
    <div className="space-y-4">
      {fields.map((f, i) => (
        <div key={f.name || i}>
          <Label required={f.required}>{f.label || "未命名字段"}</Label>
          <FieldControl
            field={f}
            value={values[f.name] ?? ""}
            onChange={(v) => onChange(f.name, v)}
            members={members}
            invalid={!!errors[f.name]}
            disabled={disabled}
          />
          {errors[f.name] && <p className="mt-1 text-xs text-danger">{errors[f.name]}</p>}
        </div>
      ))}
    </div>
  );
}
