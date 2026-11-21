import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md border border-line-strong bg-white px-2.5 text-sm text-ink placeholder:text-ink-3 transition-shadow " +
  "focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 disabled:bg-sidebar disabled:text-ink-2";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(base, "h-8", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(base, "py-1.5 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(base, "h-8 appearance-none bg-[length:16px] bg-[right_6px_center] bg-no-repeat pr-7", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a5a29c' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ children, required, className }: { children: ReactNode; required?: boolean; className?: string }) {
  return (
    <span className={cn("mb-1 block text-xs font-medium text-ink-2", className)}>
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </span>
  );
}

/** 表单字段：标签 + 控件 + 提示 */
export function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <Label required={required}>{label}</Label>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-ink", className)}>
      <input type="checkbox" className="size-3.5 rounded border-line-strong accent-accent" {...props} />
      {label}
    </label>
  );
}
