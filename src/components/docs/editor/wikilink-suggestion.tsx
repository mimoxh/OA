"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps, type Trigger } from "@tiptap/suggestion";
import { FilePlus2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListHandle } from "./suggestion";

export type WikiLinkHit = { id: string; title: string; icon: string; space: string };

export type WikiLinkAction =
  | { kind: "existing"; hit: WikiLinkHit }
  | { kind: "create"; title: string };

type WikiLinkPopupProps = {
  query: string;
  excludeId: string;
  canCreate: boolean;
  onSelect: (action: WikiLinkAction) => void;
};

const WikiLinkList = forwardRef<ListHandle, WikiLinkPopupProps>(function WikiLinkList(
  { query, excludeId, canCreate, onSelect },
  ref,
) {
  const [hits, setHits] = useState<WikiLinkHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [index, setIndex] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const delay = query.trim() ? 150 : 0;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/docs/search?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: WikiLinkHit[] }) => {
          if (reqId.current !== id) return;
          setHits((d.results ?? []).filter((h) => h.id !== excludeId));
          setIndex(0);
          setLoading(false);
        })
        .catch(() => {
          if (reqId.current === id && !ctrl.signal.aborted) setLoading(false);
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, excludeId]);

  const trimmed = query.trim();
  const hasExactMatch = trimmed
    ? hits.some((h) => h.title.trim().toLowerCase() === trimmed.toLowerCase())
    : false;
  const showCreate = canCreate && trimmed.length > 0 && trimmed.length <= 200 && !hasExactMatch;

  const actions: WikiLinkAction[] = [
    ...hits.map((hit): WikiLinkAction => ({ kind: "existing", hit })),
    ...(showCreate ? [{ kind: "create" as const, title: trimmed }] : []),
  ];

  const safeIndex = actions.length > 0 ? Math.min(index, actions.length - 1) : 0;

  const pick = (action: WikiLinkAction) => {
    if (creating) return;
    if (action.kind === "create") setCreating(true);
    onSelect(action);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.isComposing || e.keyCode === 229) return false;
      if (!actions.length) return false;
      if (e.key === "ArrowDown") {
        setIndex((safeIndex + 1) % actions.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setIndex((safeIndex - 1 + actions.length) % actions.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        pick(actions[safeIndex]);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="max-h-[320px] w-[320px] overflow-y-auto rounded-lg bg-white p-1 shadow-pop animate-pop-in">
      <div className="flex items-center justify-between px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-3">
        <span>链接到页面</span>
        {loading && <Loader2 className="size-3 animate-spin" />}
      </div>

      {!loading && actions.length === 0 && (
        <div className="px-2 py-2 text-xs text-ink-3">没有匹配的页面</div>
      )}

      {actions.map((action, i) => {
        if (action.kind === "existing") {
          const h = action.hit;
          return (
            <button
              key={h.id}
              type="button"
              ref={(el) => {
                if (el && i === safeIndex) el.scrollIntoView({ block: "nearest" });
              }}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(action)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                i === safeIndex && "bg-hover",
              )}
            >
              <span className="shrink-0 text-base leading-none">{h.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{h.title}</span>
              <span className="max-w-[100px] shrink-0 truncate text-xs text-ink-3">{h.space}</span>
            </button>
          );
        }
        return (
          <div key="__create__" className={cn(hits.length > 0 && "mt-1 border-t border-line pt-1")}>
            <button
              type="button"
              disabled={creating}
              ref={(el) => {
                if (el && i === safeIndex) el.scrollIntoView({ block: "nearest" });
              }}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(action)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-accent",
                i === safeIndex && "bg-accent-soft/70",
              )}
            >
              {creating ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <FilePlus2 className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                新建「{action.title}」并链接
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** 识别光标前的 `[[query`（支持空格与中文，遇到 `]` 或换行自动退出） */
function findWikiLinkMatch(config: Trigger) {
  const { $position } = config;
  const text = $position.nodeBefore?.isText ? $position.nodeBefore.text : null;
  if (!text) return null;
  const idx = text.lastIndexOf("[[");
  if (idx < 0) return null;
  const query = text.slice(idx + 2);
  if (query.length > 80 || /[\]\r\n]/.test(query)) return null;
  const textFrom = $position.pos - text.length;
  const from = textFrom + idx;
  const to = $position.pos;
  return { range: { from, to }, query, text: text.slice(idx) };
}

function insertDocLink(editor: Editor, range: Range, docId: string, title: string) {
  const maxPos = editor.state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, maxPos));
  const to = Math.max(from, Math.min(range.to, maxPos));
  editor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContentAt(from, [
      { type: "text", text: title || "无标题", marks: [{ type: "link", attrs: { href: `/docs/${docId}` } }] },
      { type: "text", text: " " },
    ])
    .run();
}

export type WikiLinkOptions = {
  docId: string;
  onQuickCreate: (title: string) => Promise<{ id: string; title: string } | null>;
};

export const WikiLinkSuggestion = Extension.create<WikiLinkOptions>({
  name: "wikiLinkSuggestion",
  addOptions() {
    return {
      docId: "",
      onQuickCreate: async () => null,
    };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      Suggestion<unknown, WikiLinkAction>({
        editor: this.editor,
        char: "[[",
        pluginKey: new PluginKey("wikiLinkSuggestion"),
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: findWikiLinkMatch,
        allow: ({ state, range }) => {
          const $pos = state.doc.resolve(range.from);
          if ($pos.parent.type.name === "codeBlock") return false;
          if ($pos.marks().some((m) => m.type.name === "code" || m.type.name === "link")) return false;
          return true;
        },
        items: () => [],
        command: ({ editor, range, props }) => {
          if (props.kind === "existing") {
            insertDocLink(editor, range, props.hit.id, props.hit.title);
            return;
          }
          void opts.onQuickCreate(props.title).then((created) => {
            if (!created || editor.isDestroyed) return;
            insertDocLink(editor, range, created.id, created.title || props.title);
          });
        },
        render: () => {
          let component: ReactRenderer<ListHandle, WikiLinkPopupProps> | null = null;
          let unmount: (() => void) | null = null;
          const toProps = (p: SuggestionProps<unknown, WikiLinkAction>): WikiLinkPopupProps => ({
            query: p.query,
            excludeId: opts.docId,
            canCreate: p.editor.isEditable,
            onSelect: (action) => p.command(action),
          });
          return {
            onStart: (props) => {
              component = new ReactRenderer(WikiLinkList, { props: toProps(props), editor: props.editor });
              const el = component.element as HTMLElement;
              el.style.zIndex = "60";
              unmount = props.mount(el);
            },
            onUpdate: (props) => component?.updateProps(toProps(props)),
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") return false;
              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              unmount?.();
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
