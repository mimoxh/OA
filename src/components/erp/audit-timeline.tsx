import { Avatar } from "@/components/ui/avatar";
import { formatDateTime } from "@/lib/format";

export function AuditTimeline({
  logs,
  labels,
}: {
  logs: { id: string; action: string; detail: string | null; createdAt: Date; user: { name: string; avatarColor: string } | null }[];
  labels: Record<string, string>;
}) {
  if (!logs.length) return <p className="py-4 text-sm text-ink-3">暂无操作记录</p>;
  return (
    <ol className="relative ml-2.5 border-l border-line">
      {logs.map((l) => (
        <li key={l.id} className="relative pb-3 pl-5 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-white bg-line-strong" />
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            {l.user ? (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Avatar name={l.user.name} color={l.user.avatarColor} size={18} />
                {l.user.name}
              </span>
            ) : (
              <span className="font-medium">系统</span>
            )}
            <span className="text-ink-2">{labels[l.action] ?? l.action}</span>
            {l.detail && <span className="text-ink-3">· {l.detail}</span>}
            <span className="text-xs text-ink-3">{formatDateTime(l.createdAt)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
