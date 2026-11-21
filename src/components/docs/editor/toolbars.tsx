"use client";

import { useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { Bold, Check, ChevronDown, Code, Highlighter, Italic, Link2, MessageSquarePlus, Strikethrough, Trash2, Underline, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";

function Btn({ active, onClick, title, children, className }: { active?: boolean; onClick: () => void; title: string; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink [&>svg]:size-[15px]",
        active && "text-accent hover:text-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-5 w-px bg-line" />;

const BLOCK_TYPES = [
  { key: "p", label: "文本", run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { key: "h1", label: "标题 1", run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { key: "h2", label: "标题 2", run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { key: "h3", label: "标题 3", run: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { key: "bullet", label: "无序列表", run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { key: "ordered", label: "有序列表", run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { key: "todo", label: "待办列表", run: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { key: "quote", label: "引用", run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { key: "code", label: "代码块", run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
];

/** 选中文字时弹出的格式工具栏 */
export function BubbleToolbar({ editor, onComment }: { editor: Editor; onComment: (sel: { from: number; to: number; quote: string }) => void }) {
  const [mode, setMode] = useState<"main" | "link" | "turn">("main");
  const [href, setHref] = useState("");
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : e.isActive("taskList")
              ? "todo"
              : e.isActive("orderedList")
                ? "ordered"
                : e.isActive("bulletList")
                  ? "bullet"
                  : e.isActive("blockquote")
                    ? "quote"
                    : "p",
    }),
  });

  const comment = () => {
    const { from, to } = editor.state.selection;
    onComment({ from, to, quote: editor.state.doc.textBetween(from, to, " ").slice(0, 500) });
  };

  const applyLink = () => {
    const url = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!url) chain.unsetLink().run();
    else chain.setLink({ href: /^(https?:|mailto:|\/)/.test(url) ? url : `https://${url}` }).run();
    setMode("main");
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textBubble"
      options={{ placement: "top", offset: 8, onHide: () => setMode("main") }}
      shouldShow={({ editor: e, state, from, to }) => {
        if (from === to || state.selection instanceof NodeSelection) return false;
        if (e.isActive("codeBlock")) return false;
        return state.doc.textBetween(from, to, " ").trim().length > 0;
      }}
      className="z-40"
    >
      <div className="flex items-center rounded-lg border border-line bg-white p-0.5 shadow-pop">
        {mode === "link" ? (
          <div className="flex items-center gap-1 px-1">
            <input
              autoFocus
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === "Escape") setMode("main");
              }}
              placeholder="粘贴或输入链接"
              className="h-7 w-56 rounded border border-line-strong px-2 text-[13px] outline-none focus:border-accent"
            />
            <Btn title="确定" onClick={applyLink}>
              <Check />
            </Btn>
            {s.link && (
              <Btn
                title="移除链接"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setMode("main");
                }}
              >
                <Unlink />
              </Btn>
            )}
          </div>
        ) : (
          <>
            {s.editable && (
              <>
                <div className="relative">
                  <Btn title="转换为" onClick={() => setMode(mode === "turn" ? "main" : "turn")} className="px-2">
                    {BLOCK_TYPES.find((b) => b.key === s.block)?.label ?? "文本"}
                    <ChevronDown className="!size-3" />
                  </Btn>
                  {mode === "turn" && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-md bg-white p-1 shadow-pop">
                      {BLOCK_TYPES.map((b) => (
                        <button
                          key={b.key}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            b.run(editor);
                            setMode("main");
                          }}
                          className={cn("flex h-7 w-full items-center justify-between rounded px-2 text-left text-[13px] hover:bg-hover", s.block === b.key && "text-accent")}
                        >
                          {b.label}
                          {s.block === b.key && <Check className="size-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Sep />
                <Btn title="粗体 Ctrl+B" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
                  <Bold />
                </Btn>
                <Btn title="斜体 Ctrl+I" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
                  <Italic />
                </Btn>
                <Btn title="下划线 Ctrl+U" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                  <Underline />
                </Btn>
                <Btn title="删除线" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
                  <Strikethrough />
                </Btn>
                <Btn title="行内代码" active={s.code} onClick={() => editor.chain().focus().toggleCode().run()}>
                  <Code />
                </Btn>
                <Btn title="高亮" active={s.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}>
                  <Highlighter />
                </Btn>
                <Btn
                  title="链接"
                  active={s.link}
                  onClick={() => {
                    setHref(s.href);
                    setMode("link");
                  }}
                >
                  <Link2 />
                </Btn>
                <Sep />
              </>
            )}
            <Btn title="评论" onClick={comment} className="px-2">
              <MessageSquarePlus />
              评论
            </Btn>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

/** 光标位于表格内时显示的表格操作栏 */
export function TableToolbar({ editor }: { editor: Editor }) {
  const run = (fn: (e: Editor) => boolean) => () => fn(editor);
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      options={{ placement: "top-start", offset: 6, flip: false }}
      shouldShow={({ editor: e, state }) => e.isEditable && e.isActive("table") && (state.selection.empty || state.selection instanceof CellSelection)}
      getReferencedVirtualElement={() => {
        const { node } = editor.view.domAtPos(editor.state.selection.from);
        const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest("table");
        if (!el) return null;
        return { getBoundingClientRect: () => el.getBoundingClientRect(), getClientRects: () => el.getClientRects() };
      }}
      className="z-30"
    >
      <div className="flex items-center rounded-lg border border-line bg-white p-0.5 text-[12px] shadow-pop">
        <Btn title="在上方插入行" onClick={run((e) => e.chain().focus().addRowBefore().run())}>
          上方插行
        </Btn>
        <Btn title="在下方插入行" onClick={run((e) => e.chain().focus().addRowAfter().run())}>
          下方插行
        </Btn>
        <Btn title="在左侧插入列" onClick={run((e) => e.chain().focus().addColumnBefore().run())}>
          左侧插列
        </Btn>
        <Btn title="在右侧插入列" onClick={run((e) => e.chain().focus().addColumnAfter().run())}>
          右侧插列
        </Btn>
        <Sep />
        <Btn title="删除当前行" onClick={run((e) => e.chain().focus().deleteRow().run())}>
          删除行
        </Btn>
        <Btn title="删除当前列" onClick={run((e) => e.chain().focus().deleteColumn().run())}>
          删除列
        </Btn>
        <Sep />
        <Btn title="切换表头行" onClick={run((e) => e.chain().focus().toggleHeaderRow().run())}>
          表头
        </Btn>
        <Btn title="合并或拆分单元格" onClick={run((e) => e.chain().focus().mergeOrSplit().run())}>
          合并/拆分
        </Btn>
        <Btn title="删除表格" onClick={run((e) => e.chain().focus().deleteTable().run())} className="text-danger hover:text-danger">
          <Trash2 />
        </Btn>
      </div>
    </BubbleMenu>
  );
}
