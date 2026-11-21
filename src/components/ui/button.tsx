import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "default" | "ghost" | "danger" | "subtle";
type Size = "xs" | "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-card",
  default: "bg-white text-ink border border-line-strong hover:bg-hover shadow-card",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  subtle: "bg-hover text-ink hover:bg-active",
  danger: "bg-white text-danger border border-line-strong hover:bg-tag-red/50",
};

const sizes: Record<Size, string> = {
  xs: "h-6 px-1.5 text-xs gap-1 rounded",
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-sm gap-1.5 rounded-md",
};

export function buttonClass(variant: Variant = "default", size: Size = "sm", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent/50",
    variants[variant],
    sizes[size],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "sm", loading, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...props}>
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});

export function LinkButton({
  variant = "default",
  size = "sm",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "md" }>(
  function IconButton({ className, size = "sm", type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center rounded text-ink-3 transition-colors hover:bg-active hover:text-ink disabled:opacity-40",
          size === "sm" ? "size-6" : "size-7",
          className,
        )}
        {...props}
      />
    );
  },
);
