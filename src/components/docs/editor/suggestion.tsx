"use client";

import { forwardRef, useImperativeHandle, useState, type ComponentType, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import {
  AtSign,
  CheckSquare,
  Code2,
  Database,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Paperclip,
  Quote,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type ListHandle = { onKeyDown: (e: KeyboardEvent) => boolean };
type ListProps<I> = { items: I[]; command: (item: I) => void; query: string };

/** 通用的 suggestion 弹层渲染：使用 @tiptap/suggestion 的 mount() 托管定位 */
export function renderSuggestion<I>(Component: ForwardRefExoticComponent<ListProps<I> & RefAttributes<ListHandle>>) {
  return () => {
    let component: ReactRenderer<ListHandle, ListProps<I>> | null = null;
    let unmount: (() => void) | null = null;
    const toProps = (p: SuggestionProps<I, I>): ListProps<I> => ({ items: p.items, command: p.command, query: p.query });
    return {
      onStart: (props: SuggestionProps<I, I>) => {
        component = new ReactRenderer(Component as unknown as ComponentType<ListProps<I>>, { props: toProps(props), editor: props.editor });
        const el = component.element as HTMLElement;
        el.style.zIndex = "60";
        unmount = props.mount(el);
      },
      onUpdate: (props: SuggestionProps<I, I>) => component?.updateProps(toProps(props)),
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
  };
}

function useListKeys<I>(items: I[], command: (item: I) => void) {
  const [state, setState] = useState({ items, index: 0 });
  let index = state.index;
  if (state.items !== items) {
    index = 0;
    setState({ items, index: 0 });
  }
  const handle: ListHandle = {
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === "ArrowDown") {
        setState({ items, index: (index + 1) % items.length });
        return true;
      }
      if (e.key === "ArrowUp") {
        setState({ items, index: (index - 1 + items.length) % items.length });
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        command(items[index]);
        return true;
      }
      return false;
    },
  };
  return { index, setIndex: (i: number) => setState({ items, index: i }), handle };
}

// ───────────── 斜杠命令 ─────────────

export type SlashItem = {
  key: string;
  group: string;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
};

export function buildSlashItems(cb: {
  onImage: (range: Range) => void;
  onFile: (range: Range) => void;
  onLinkPage: (range: Range) => void;
  onCreateDatabase?: (range: Range) => void;
  onLinkDatabase?: (range: Range) => void;
  onEmbedWhiteboard?: (range: Range) => void;
}): SlashItem[] {
  const c = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
  return [
    { key: "text", group: "基础块", title: "文本", description: "普通段落文字", icon: Type, keywords: ["text", "paragraph", "wenben", "wb", "duanluo"], run: (e, r) => c(e, r).setParagraph().run() },
    { key: "h1", group: "基础块", title: "标题 1", description: "大号标题", icon: Heading1, keywords: ["h1", "heading", "biaoti", "bt", "title"], run: (e, r) => c(e, r).setHeading({ level: 1 }).run() },
    { key: "h2", group: "基础块", title: "标题 2", description: "中号标题", icon: Heading2, keywords: ["h2", "heading", "biaoti", "bt"], run: (e, r) => c(e, r).setHeading({ level: 2 }).run() },
    { key: "h3", group: "基础块", title: "标题 3", description: "小号标题", icon: Heading3, keywords: ["h3", "heading", "biaoti", "bt"], run: (e, r) => c(e, r).setHeading({ level: 3 }).run() },
    { key: "bullet", group: "基础块", title: "无序列表", description: "简单的项目符号列表", icon: List, keywords: ["bullet", "ul", "list", "wuxu", "liebiao", "lb"], run: (e, r) => c(e, r).toggleBulletList().run() },
    { key: "ordered", group: "基础块", title: "有序列表", description: "带编号的列表", icon: ListOrdered, keywords: ["ordered", "ol", "number", "youxu", "liebiao", "bianhao"], run: (e, r) => c(e, r).toggleOrderedList().run() },
    { key: "todo", group: "基础块", title: "待办列表", description: "用复选框跟踪任务", icon: CheckSquare, keywords: ["todo", "task", "check", "daiban", "db", "renwu"], run: (e, r) => c(e, r).toggleTaskList().run() },
    { key: "quote", group: "基础块", title: "引用", description: "引用一段文字", icon: Quote, keywords: ["quote", "blockquote", "yinyong", "yy"], run: (e, r) => c(e, r).toggleBlockquote().run() },
    { key: "callout", group: "基础块", title: "提示框", description: "突出显示的提示信息", icon: Lightbulb, keywords: ["callout", "tip", "tishi", "ts", "note"], run: (e, r) => c(e, r).setParagraph().setCallout().run() },
    { key: "code", group: "基础块", title: "代码块", description: "插入一段代码", icon: Code2, keywords: ["code", "codeblock", "daima", "dm"], run: (e, r) => c(e, r).toggleCodeBlock().run() },
    { key: "hr", group: "基础块", title: "分割线", description: "视觉上分隔内容", icon: Minus, keywords: ["divider", "hr", "line", "fenge", "fgx"], run: (e, r) => c(e, r).setHorizontalRule().run() },
    { key: "table", group: "插入", title: "表格", description: "插入 3×3 表格", icon: Table2, keywords: ["table", "biaoge", "bg"], run: (e, r) => c(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    ...(cb.onCreateDatabase
      ? [
          {
            key: "database",
            group: "插入",
            title: "多维表格",
            description: "新建多维表格并嵌入当前页面",
            icon: Database,
            keywords: ["database", "db", "duowei", "duoweibiaoge", "dwbg", "board", "kanban"],
            run: (e: Editor, r: Range) => {
              c(e, r).run();
              cb.onCreateDatabase?.(r);
            },
          },
        ]
      : []),
    ...(cb.onLinkDatabase
      ? [
          {
            key: "link-database",
            group: "插入",
            title: "关联表格",
            description: "嵌入已有的多维表格视图",
            icon: Link2,
            keywords: ["linked", "linkdb", "guanlian", "guanlianbiaoge", "glbg", "database"],
            run: (e: Editor, r: Range) => {
              c(e, r).run();
              cb.onLinkDatabase?.(r);
            },
          },
        ]
      : []),
    ...(cb.onEmbedWhiteboard ? [{
      key: "whiteboard",
      group: "插入",
      title: "嵌入白板",
      description: "在文档内显示并使用已有白板",
      icon: Palette,
      keywords: ["whiteboard", "canvas", "baiban"],
      run: (e: Editor, r: Range) => {
        c(e, r).run();
        cb.onEmbedWhiteboard?.(r);
      },
    }] : []),
    {
      key: "image",
      group: "插入",
      title: "图片",
      description: "通过链接插入图片",
      icon: ImageIcon,
      keywords: ["image", "img", "picture", "tupian", "tp"],
      run: (e, r) => {
        c(e, r).run();
        cb.onImage(r);
      },
    },
    {
      key: "file",
      group: "插入",
      title: "文件",
      description: "上传并插入附件",
      icon: Paperclip,
      keywords: ["file", "attachment", "fujian", "wenjian", "fj", "fujia"],
      run: (e, r) => {
        c(e, r).run();
        cb.onFile(r);
      },
    },
    {
      key: "page",
      group: "插入",
      title: "链接到页面",
      description: "引用其他文档页面",
      icon: FileText,
      keywords: ["link", "page", "lianjie", "yemian", "wendang", "lj"],
      run: (e, r) => {
        c(e, r).run();
        cb.onLinkPage(r);
      },
    },
    { key: "mention", group: "插入", title: "提及成员", description: "@ 同事，对方会收到通知", icon: AtSign, keywords: ["mention", "at", "tiji", "tj", "people"], run: (e, r) => c(e, r).insertContent("@").run() },
  ];
}

export function filterSlash(items: SlashItem[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.startsWith(q) || k.includes(q)));
}

export const SlashList = forwardRef<ListHandle, ListProps<SlashItem>>(function SlashList({ items, command }, ref) {
  const { index, setIndex, handle } = useListKeys(items, command);
  useImperativeHandle(ref, () => handle);
  return (
    <div className="max-h-[340px] w-[300px] overflow-y-auto rounded-lg bg-white p-1 shadow-pop animate-pop-in">
      {items.length === 0 && <div className="px-3 py-2 text-sm text-ink-3">没有匹配的命令</div>}
      {items.map((item, i) => {
        const header = i === 0 || items[i - 1].group !== item.group ? item.group : null;
        const Icon = item.icon;
        return (
          <div key={item.key}>
            {header && <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-ink-3">{header}</div>}
            <button
              type="button"
              ref={(el) => {
                if (el && i === index) el.scrollIntoView({ block: "nearest" });
              }}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left", i === index && "bg-hover")}
            >
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-md border border-line bg-white text-ink-2">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-ink">{item.title}</span>
                <span className="block truncate text-xs text-ink-3">{item.description}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

export const SlashCommand = Extension.create<{ items: () => SlashItem[] }>({
  name: "slashCommand",
  addOptions() {
    return { items: () => [] };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        pluginKey: new PluginKey("slashCommand"),
        allowedPrefixes: null,
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
        items: ({ query }) => filterSlash(this.options.items(), query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: renderSuggestion(SlashList),
      }),
    ];
  },
});

// ───────────── @ 提及 ─────────────

export type MentionItem = { id: string; label: string; color: string; title: string | null };

export const MentionList = forwardRef<ListHandle, ListProps<MentionItem>>(function MentionList({ items, command }, ref) {
  const { index, setIndex, handle } = useListKeys(items, command);
  useImperativeHandle(ref, () => handle);
  return (
    <div className="max-h-[300px] w-[240px] overflow-y-auto rounded-lg bg-white p-1 shadow-pop animate-pop-in">
      <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-3">提及成员</div>
      {items.length === 0 && <div className="px-2 py-1.5 text-sm text-ink-3">没有匹配的成员</div>}
      {items.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(m)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", i === index && "bg-hover")}
        >
          <Avatar name={m.label} color={m.color} size={22} />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.label}</span>
          {m.title && <span className="shrink-0 text-xs text-ink-3">{m.title}</span>}
        </button>
      ))}
    </div>
  );
});

export function mentionSuggestion(
  getMembers: () => MentionItem[],
  onMention: (id: string) => void,
): Omit<SuggestionOptions<MentionItem, MentionItem>, "editor"> {
  return {
    char: "@",
    allowedPrefixes: null,
    items: ({ query }) => {
      const q = query.trim().toLowerCase();
      return getMembers()
        .filter((m) => !q || m.label.toLowerCase().includes(q) || (m.title ?? "").toLowerCase().includes(q))
        .slice(0, 8);
    },
    command: ({ editor, range, props }) => {
      const nodeAfter = editor.view.state.selection.$to.nodeAfter;
      if (nodeAfter?.text?.startsWith(" ")) range.to += 1;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs: { id: props.id, label: props.label } },
          { type: "text", text: " " },
        ])
        .run();
      onMention(props.id);
    },
    render: renderSuggestion(MentionList),
  };
}
