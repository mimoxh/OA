import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="rounded bg-hover px-1 py-0.5 font-mono text-[0.9em] text-[#eb5757]">{tok.slice(1, -1)}</code>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? [];
      const safe = href && (/^https?:\/\//.test(href) || href.startsWith("/"));
      out.push(
        safe ? (
          <a key={key} href={href} className="text-accent underline underline-offset-2" target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
            {label}
          </a>
        ) : (
          tok
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 轻量 Markdown：标题、列表、引用、分隔线、粗体、行内代码、链接；其他内容按段落与换行原样显示 */
export function SimpleMarkdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "mt-6 text-2xl font-bold" : level === 2 ? "mt-5 text-xl font-semibold" : "mt-4 text-lg font-semibold";
      blocks.push(
        <div key={key} role="heading" aria-level={level + 1} className={`${cls} mb-1 text-ink`}>
          {inline(h[2], key)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key} className="my-4 border-line" />);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push(
        <ul key={key} className="my-1.5 list-disc space-y-0.5 pl-6">
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(
        <ol key={key} className="my-1.5 list-decimal space-y-0.5 pl-6">
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${key}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) items.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={key} className="my-2 border-l-[3px] border-ink pl-3.5 text-ink">
          {items.map((t, j) => (
            <div key={j}>{inline(t, `${key}-${j}`)}</div>
          ))}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    )
      para.push(lines[i++]);
    blocks.push(
      <p key={key} className="my-2">
        {para.map((t, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(t, `${key}-${j}`)}
          </span>
        ))}
      </p>,
    );
  }
  return <div className={`text-[15px] leading-7 text-ink ${className ?? ""}`}>{blocks}</div>;
}
