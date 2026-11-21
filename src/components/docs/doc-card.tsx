import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { formatDateTime, formatRelative } from "@/lib/format";
import { coverStyle } from "@/lib/docs/constants";

export type DocCardData = {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  text: string;
  updatedAt: Date;
  space: { name: string; icon: string };
  updatedBy: { name: string; avatarColor: string } | null;
};

export function DocCard({ doc }: { doc: DocCardData }) {
  const cover = coverStyle(doc.cover);
  return (
    <Link
      href={`/docs/${doc.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-card"
    >
      <div className="relative h-14 bg-sidebar" style={cover ? { background: cover } : undefined}>
        <span className="absolute -bottom-4 left-4 text-[28px] leading-none">{doc.icon || "📄"}</span>
      </div>
      <div className="flex flex-1 flex-col px-4 pb-3 pt-6">
        <div className="truncate text-[15px] font-semibold text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
          {doc.title || "无标题"}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-ink-2">{doc.text.slice(0, 160) || "空白页面"}</p>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
          <span className="truncate">
            {doc.space.icon} {doc.space.name}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1" title={formatDateTime(doc.updatedAt)}>
            {doc.updatedBy && <Avatar name={doc.updatedBy.name} color={doc.updatedBy.avatarColor} size={16} />}
            {formatRelative(doc.updatedAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
