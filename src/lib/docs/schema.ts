import { Mark, Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => el.getAttribute("data-emoji") ?? "💡",
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "callout", class: "doc-callout" }, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },
});

/** 划词评论标记：commentId 指向 Comment 表中的线程 */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) => ({ "data-comment-id": attrs.commentId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "doc-comment" }, HTMLAttributes), 0];
  },
});

/**
 * 文档编辑器的 schema 扩展列表。协同服务端（TiptapTransformer）与浏览器端共用，
 * 两端 schema 必须一致，否则 Yjs 内容无法互相转换。
 */
export function createSchemaExtensions(opts: { mention?: { suggestion?: unknown } } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Highlight,
    Image,
    Mention.configure({
      HTMLAttributes: { class: "doc-mention" },
      ...(opts.mention as Partial<MentionOptions> | undefined),
    }),
    Callout,
    CommentMark,
  ];
}

export const COLLAB_FIELD = "default";
