import { cn } from "@/lib/utils";

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "?";
  // 中文名取最后两个字（飞书风格），英文名取首字母
  if (/[\u4e00-\u9fa5]/.test(n)) return n.length > 2 ? n.slice(-2) : n;
  const parts = n.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({
  name,
  color = "#6b7280",
  size = 20,
  className,
}: {
  name?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const text = initials(name);
  const label = size < 24 && text.length > 1 && /[\u4e00-\u9fa5]/.test(text) ? text.slice(-1) : text;
  return (
    <span
      title={name ?? undefined}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * (label.length > 1 ? 0.36 : 0.46)),
        backgroundColor: color ?? "#6b7280",
      }}
    >
      {label}
    </span>
  );
}

export function UserChip({ name, color, className }: { name?: string | null; color?: string | null; className?: string }) {
  if (!name) return <span className="text-ink-3">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Avatar name={name} color={color} size={18} />
      <span>{name}</span>
    </span>
  );
}

export function AvatarStack({ users, max = 4 }: { users: { name: string; avatarColor?: string | null }[]; max?: number }) {
  const shown = users.slice(0, max);
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((u, i) => (
        <Avatar key={i} name={u.name} color={u.avatarColor} size={22} className="ring-2 ring-white" />
      ))}
      {users.length > max && (
        <span className="inline-flex size-[22px] items-center justify-center rounded-full bg-hover text-[10px] text-ink-2 ring-2 ring-white">
          +{users.length - max}
        </span>
      )}
    </span>
  );
}
