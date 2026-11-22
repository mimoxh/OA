"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Node = { type?: string; text?: string; attrs?: { id?: string; label?: string }; content?: Node[] };

const URL_RE = /(https?:\/\/[^\s<>"'）】]+|(?<![\w/])\/[\w\-/?#=&%.]+)/g;

/** 文本里的 URL / 站内路径转可点击链接 */
function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    // 去掉常见尾随标点
    const trimmed = raw.replace(/[.,;:!?，。；：！？]+$/g, "");
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const href = trimmed;
    if (href.startsWith("http")) {
      let sameOrigin = false;
      try {
        sameOrigin = typeof window !== "undefined" && new URL(href).origin === window.location.origin;
      } catch {}
      parts.push(
        sameOrigin ? (
          <Link key={key++} href={new URL(href).pathname + new URL(href).search} className="text-accent hover:underline">
            {trimmed}
          </Link>
        ) : (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {trimmed}
          </a>
        ),
      );
    } else {
      parts.push(
        <Link key={key++} href={href} className="text-accent hover:underline">
          {trimmed}
        </Link>,
      );
    }
    last = idx + raw.length - (raw.length - trimmed.length);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * 服务端校验过的 Tiptap 文档渲染器（doc > paragraph* > text | hardBreak | mention）。
 * 不实例化编辑器；mention 命中自己或 all 时高亮。
 */
export function MessageContent({ content, meId }: { content: unknown; meId: string | null }) {
  const doc = content as { type?: string; content?: Node[] } | null;
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return null;
  return (
    <div className="whitespace-pre-wrap break-words">
      {doc.content.map((p, i) => {
        const children = (p.content ?? []).map((n, j) => {
          if (n.type === "text") return <Linkified key={j} text={n.text ?? ""} />;
          if (n.type === "hardBreak") return <br key={j} />;
          if (n.type === "mention") {
            const id = n.attrs?.id;
            const hit = id === "all" || id === meId;
            return (
              <span
                key={j}
                className={cn(
                  "doc-mention rounded px-0.5 font-medium text-accent",
                  hit && "bg-accent-soft",
                )}
              >
                @{n.attrs?.label ?? "成员"}
              </span>
            );
          }
          return null;
        });
        return (
          <div key={i} className="min-h-[1.2em]">
            {children}
          </div>
        );
      })}
    </div>
  );
}
