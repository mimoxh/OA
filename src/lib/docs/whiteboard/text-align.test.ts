import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getWhiteboardTextEditorLayout,
  layoutArrowLabel,
  layoutWhiteboardText,
  paintWhiteboard,
  wrapWhiteboardText,
} from "./canvas";
import {
  DEFAULT_WHITEBOARD_TEXT_ALIGN,
  DEFAULT_WHITEBOARD_VERTICAL_ALIGN,
  parseWhiteboard,
  resolveWhiteboardTextAlign,
  resolveWhiteboardVerticalAlign,
  whiteboardUpdateSchema,
  type WhiteboardBoxTextElement,
  type WhiteboardElement,
} from "./content";
import { makeArrow, makeFigure, type FigureType } from "./geometry";

const IDS = {
  rect: "00000000-0000-4000-8000-000000000001",
  ellipse: "00000000-0000-4000-8000-000000000002",
  diamond: "00000000-0000-4000-8000-000000000003",
  note: "00000000-0000-4000-8000-000000000004",
  text: "00000000-0000-4000-8000-000000000005",
  frame: "00000000-0000-4000-8000-000000000006",
  arrow: "00000000-0000-4000-8000-000000000007",
  page: "00000000-0000-4000-8000-000000000008",
  image: "00000000-0000-4000-8000-000000000009",
  attachment: "00000000-0000-4000-8000-000000000010",
  pen: "00000000-0000-4000-8000-000000000011",
};

type RecordedFillText = {
  text: string;
  x: number;
  y: number;
  maxWidth: number | undefined;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

function createMockContext() {
  const calls: RecordedFillText[] = [];
  const state = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetY: 0,
    font: "15px system-ui",
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
  };
  const noop = () => {};
  const ctx = {
    ...state,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    ellipse: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    setLineDash: noop,
    drawImage: noop,
    measureText(segment: string) {
      return { width: segment.length * 10 };
    },
    fillText(text: string, x: number, y: number, maxWidth?: number) {
      calls.push({
        text,
        x,
        y,
        maxWidth,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
      });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("whiteboard element default alignment", () => {
  it("defaults box text elements to center/middle and frame to center/top", () => {
    const centeredTypes: FigureType[] = ["rectangle", "ellipse", "diamond", "note", "text"];
    for (const type of centeredTypes) {
      const element = makeFigure(IDS.rect, type, { x: 10, y: 20 }, { x: 10, y: 20 }, "blue");
      assert.equal(element.type, type);
      assert.equal(element.textAlign, DEFAULT_WHITEBOARD_TEXT_ALIGN);
      assert.equal(element.verticalAlign, DEFAULT_WHITEBOARD_VERTICAL_ALIGN);
    }

    const frame = makeFigure(IDS.frame, "frame", { x: 0, y: 0 }, { x: 0, y: 0 }, "gray");
    assert.equal(frame.type, "frame");
    if (frame.type === "frame") {
      assert.equal(frame.text, "框架");
      assert.equal(frame.textAlign, "center");
      assert.equal(frame.verticalAlign, "top");
    }

    const arrow = makeArrow(IDS.arrow, { x: 0, y: 0 }, { x: 100, y: 0 }, "blue");
    assert.equal(arrow.textAlign, "center");
  });

  it("preserves explicit manual alignment overrides when creating elements", () => {
    const rect = makeFigure(IDS.rect, "rectangle", { x: 0, y: 0 }, { x: 120, y: 80 }, "blue", {
      textAlign: "left",
      verticalAlign: "bottom",
    });
    if (rect.type === "rectangle") {
      assert.equal(rect.textAlign, "left");
      assert.equal(rect.verticalAlign, "bottom");
    }

    const arrow = makeArrow(IDS.arrow, { x: 0, y: 0 }, { x: 100, y: 0 }, "teal", "right");
    assert.equal(arrow.textAlign, "right");
  });
});

describe("whiteboard schema compatibility and validation", () => {
  it("parses historical scenes without alignment properties and resolves defaults to center", () => {
    const legacyScene = JSON.stringify({
      version: 1,
      revision: 3,
      elements: [
        { id: IDS.rect, type: "rectangle", x: 0, y: 0, width: 160, height: 96, text: "旧矩形", color: "blue" },
        { id: IDS.frame, type: "frame", x: 10, y: 10, width: 380, height: 250, text: "旧框架", color: "gray" },
        { id: IDS.arrow, type: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, text: "旧连线", color: "blue" },
      ],
    });
    const parsed = parseWhiteboard(legacyScene);
    assert.ok(parsed);
    assert.equal(parsed.elements.length, 3);

    const [rect, frame, arrow] = parsed.elements;
    assert.equal("textAlign" in rect ? rect.textAlign : undefined, undefined);
    if (rect.type === "rectangle") {
      assert.equal(resolveWhiteboardTextAlign(rect), "center");
      assert.equal(resolveWhiteboardVerticalAlign(rect), "middle");
    }
    if (frame.type === "frame") {
      assert.equal(resolveWhiteboardTextAlign(frame), "center");
      assert.equal(resolveWhiteboardVerticalAlign(frame), "top");
    }
    if (arrow.type === "arrow") {
      assert.equal(resolveWhiteboardTextAlign(arrow), "center");
    }
  });

  it("accepts explicit valid alignments and rejects invalid alignment fields", () => {
    const valid = whiteboardUpdateSchema.safeParse({
      expectedRevision: 0,
      elements: [
        {
          id: IDS.note,
          type: "note",
          x: 0,
          y: 0,
          width: 176,
          height: 146,
          text: "便签",
          color: "yellow",
          textAlign: "right",
          verticalAlign: "bottom",
        },
        {
          id: IDS.arrow,
          type: "arrow",
          from: { x: 0, y: 0 },
          to: { x: 80, y: 40 },
          text: "审批",
          color: "teal",
          textAlign: "left",
        },
      ],
    });
    assert.equal(valid.success, true);

    const invalidAlignValue = whiteboardUpdateSchema.safeParse({
      expectedRevision: 0,
      elements: [
        {
          id: IDS.text,
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 60,
          text: "abc",
          color: "blue",
          textAlign: "justify",
        },
      ],
    });
    assert.equal(invalidAlignValue.success, false);

    const invalidArrowVerticalAlign = whiteboardUpdateSchema.safeParse({
      expectedRevision: 0,
      elements: [
        {
          id: IDS.arrow,
          type: "arrow",
          from: { x: 0, y: 0 },
          to: { x: 80, y: 40 },
          text: "abc",
          color: "blue",
          verticalAlign: "middle",
        },
      ],
    });
    assert.equal(invalidArrowVerticalAlign.success, false);

    const invalidPenAlign = whiteboardUpdateSchema.safeParse({
      expectedRevision: 0,
      elements: [
        {
          id: IDS.pen,
          type: "pen",
          x: 0,
          y: 0,
          width: 40,
          height: 40,
          points: [{ x: 0, y: 0 }],
          color: "blue",
          textAlign: "center",
        },
      ],
    });
    assert.equal(invalidPenAlign.success, false);
  });
});

describe("whiteboard text layout math", () => {
  const measure = (segment: string) => segment.length * 10;

  it("wraps paragraphs, preserves middle empty lines, and ignores trailing empty line", () => {
    assert.deepEqual(wrapWhiteboardText("abcdef", 30, measure), ["abc", "def"]);
    assert.deepEqual(wrapWhiteboardText("a\n\nb", 100, measure), ["a", "", "b"]);
    assert.deepEqual(wrapWhiteboardText("hello\n", 100, measure), ["hello"]);
  });

  it("centers single-line and multi-line text horizontally and vertically by default", () => {
    const single = layoutWhiteboardText("标题", { x: 12, y: 11, width: 136, height: 74, lineHeight: 21 }, measure);
    assert.equal(single.textAlign, "center");
    assert.deepEqual(single.lines, [{ text: "标题", x: 80, y: 48 }]);

    const multi = layoutWhiteboardText("第一行\n第二行", { x: 0, y: 0, width: 100, height: 100, lineHeight: 20 }, measure);
    assert.equal(multi.textAlign, "center");
    assert.deepEqual(multi.lines, [
      { text: "第一行", x: 50, y: 40 },
      { text: "第二行", x: 50, y: 60 },
    ]);
  });

  it("honors explicit left/right and top/bottom alignment and truncates overflow lines", () => {
    const leftTop = layoutWhiteboardText(
      "l1\nl2\nl3\nl4",
      { x: 10, y: 20, width: 100, height: 45, lineHeight: 20, textAlign: "left", verticalAlign: "top" },
      measure,
    );
    assert.equal(leftTop.textAlign, "left");
    assert.deepEqual(leftTop.lines, [
      { text: "l1", x: 10, y: 30 },
      { text: "l2", x: 10, y: 50 },
    ]);

    const rightBottom = layoutWhiteboardText(
      "ok",
      { x: 10, y: 20, width: 100, height: 80, lineHeight: 20, textAlign: "right", verticalAlign: "bottom" },
      measure,
    );
    assert.equal(rightBottom.textAlign, "right");
    assert.deepEqual(rightBottom.lines, [{ text: "ok", x: 110, y: 90 }]);
  });

  it("centers arrow labels above midpoint by default and shifts for left/right", () => {
    const centered = layoutArrowLabel("通过", { x: 100, y: 50 }, "center", measure);
    assert.equal(centered.textAlign, "center");
    assert.deepEqual(centered.lines, [{ text: "通过", x: 100, y: 35 }]);

    const left = layoutArrowLabel("通过", { x: 100, y: 50 }, "left", measure);
    assert.equal(left.textAlign, "left");
    assert.equal(left.lines[0].x, 105);

    const right = layoutArrowLabel("通过", { x: 100, y: 50 }, "right", measure);
    assert.equal(right.textAlign, "right");
    assert.equal(right.lines[0].x, 95);
  });
});

describe("paintWhiteboard rendering integration", () => {
  it("renders all text-bearing elements centered by default and isolates manual alignment per element", () => {
    const elements: WhiteboardElement[] = [
      // Legacy rectangle without alignment fields -> center / middle
      { id: IDS.rect, type: "rectangle", x: 0, y: 0, width: 160, height: 96, text: "矩形", color: "blue" },
      // Manual left/bottom note -> should not leak alignment to next elements
      {
        id: IDS.note,
        type: "note",
        x: 200,
        y: 0,
        width: 176,
        height: 146,
        text: "左底便签",
        color: "yellow",
        textAlign: "left",
        verticalAlign: "bottom",
      },
      // Diamond -> center / middle
      { id: IDS.diamond, type: "diamond", x: 400, y: 0, width: 144, height: 112, text: "菱形", color: "teal" },
      // Frame -> center / top (inside top 30px hit band)
      { id: IDS.frame, type: "frame", x: 0, y: 200, width: 380, height: 250, text: "框架标题", color: "gray" },
      // Arrow -> center at midpoint (100, 500)
      { id: IDS.arrow, type: "arrow", from: { x: 0, y: 500 }, to: { x: 200, y: 500 }, text: "连线", color: "purple" },
      // Page card -> center / middle
      { id: IDS.page, type: "page", x: 400, y: 200, width: 216, height: 66, documentId: "doc_1" },
      // Unloaded image placeholder -> center / middle
      { id: IDS.image, type: "image", x: 400, y: 300, width: 200, height: 120, attachmentId: IDS.attachment },
    ];

    const { ctx, calls } = createMockContext();
    paintWhiteboard(ctx, elements, {
      width: 1200,
      height: 800,
      view: { x: 0, y: 0, scale: 1 },
      references: new Map([["doc_1", { id: "doc_1", title: "设计文档", icon: "📄" }]]),
      images: new Map(),
    });

    const byText = new Map(calls.map((entry) => [entry.text, entry]));

    const rectCall = byText.get("矩形");
    assert.ok(rectCall);
    assert.equal(rectCall.textAlign, "center");
    assert.equal(rectCall.textBaseline, "middle");
    assert.equal(rectCall.x, 80);
    assert.equal(rectCall.y, 48);

    const noteCall = byText.get("左底便签");
    assert.ok(noteCall);
    assert.equal(noteCall.textAlign, "left");
    assert.equal(noteCall.x, 212);
    assert.equal(noteCall.y, 146 - 11 - 10.5);

    const diamondCall = byText.get("菱形");
    assert.ok(diamondCall);
    assert.equal(diamondCall.textAlign, "center");
    assert.equal(diamondCall.x, 472);
    assert.equal(diamondCall.y, 56);

    const frameCall = byText.get("框架标题");
    assert.ok(frameCall);
    assert.equal(frameCall.textAlign, "center");
    assert.equal(frameCall.x, 190);
    assert.ok(frameCall.y > 200 && frameCall.y < 230);

    const arrowCall = byText.get("连线");
    assert.ok(arrowCall);
    assert.equal(arrowCall.textAlign, "center");
    assert.equal(arrowCall.x, 100);
    assert.equal(arrowCall.y, 485);

    const pageCall = byText.get("📄  设计文档");
    assert.ok(pageCall);
    assert.equal(pageCall.textAlign, "center");
    assert.equal(pageCall.x, 508);
    assert.equal(pageCall.y, 233);

    const imageCall = byText.get("正在加载图片");
    assert.ok(imageCall);
    assert.equal(imageCall.textAlign, "center");
    assert.equal(imageCall.x, 500);
    assert.equal(imageCall.y, 360);
  });

  it("suppresses underlying canvas text for editingId while keeping other elements rendered", () => {
    const elements: WhiteboardElement[] = [
      { id: IDS.rect, type: "rectangle", x: 0, y: 0, width: 160, height: 96, text: "正在编辑的矩形", color: "blue" },
      { id: IDS.note, type: "note", x: 200, y: 0, width: 176, height: 146, text: "普通便签", color: "yellow" },
      { id: IDS.arrow, type: "arrow", from: { x: 0, y: 200 }, to: { x: 200, y: 200 }, text: "连线标签", color: "teal" },
    ];

    const rectEdit = createMockContext();
    paintWhiteboard(rectEdit.ctx, elements, {
      width: 800,
      height: 600,
      view: { x: 0, y: 0, scale: 1 },
      references: new Map(),
      images: new Map(),
      selectedId: IDS.rect,
      editingId: IDS.rect,
    });
    assert.deepEqual(
      rectEdit.calls.map((c) => c.text),
      ["普通便签", "连线标签"],
    );

    const arrowEdit = createMockContext();
    paintWhiteboard(arrowEdit.ctx, elements, {
      width: 800,
      height: 600,
      view: { x: 0, y: 0, scale: 1 },
      references: new Map(),
      images: new Map(),
      selectedId: IDS.arrow,
      editingId: IDS.arrow,
    });
    assert.deepEqual(
      arrowEdit.calls.map((c) => c.text),
      ["正在编辑的矩形", "普通便签"],
    );
  });
});

describe("whiteboard inline text editor layout", () => {
  it("maps box text elements with exact insets, font sizes, alignments, and zoom/pan transform", () => {
    const view = { x: 40, y: -20, scale: 1.5 };
    const rect: WhiteboardBoxTextElement = {
      id: IDS.rect,
      type: "rectangle",
      x: 100,
      y: 80,
      width: 160,
      height: 96,
      text: "矩形",
      color: "blue",
    };
    const diamond: WhiteboardBoxTextElement = {
      id: IDS.diamond,
      type: "diamond",
      x: 200,
      y: 100,
      width: 144,
      height: 112,
      text: "判断",
      color: "teal",
      textAlign: "left",
      verticalAlign: "bottom",
    };
    const textItem: WhiteboardBoxTextElement = {
      id: IDS.text,
      type: "text",
      x: 10,
      y: 20,
      width: 216,
      height: 70,
      text: "自由文字",
      color: "gray",
    };
    const frame: WhiteboardBoxTextElement = {
      id: IDS.frame,
      type: "frame",
      x: 0,
      y: 0,
      width: 380,
      height: 250,
      text: "框架",
      color: "gray",
    };
    const byId = new Map<string, WhiteboardElement>([rect, diamond, textItem, frame].map((e) => [e.id, e]));

    const rectLayout = getWhiteboardTextEditorLayout(rect, byId, view);
    assert.equal(rectLayout.left, (100 + 12) * 1.5 + 40);
    assert.equal(rectLayout.top, (80 + 11) * 1.5 - 20);
    assert.equal(rectLayout.width, (160 - 24) * 1.5);
    assert.equal(rectLayout.height, (96 - 22) * 1.5);
    assert.equal(rectLayout.fontSize, 15 * 1.5);
    assert.equal(rectLayout.lineHeight, 21 * 1.5);
    assert.equal(rectLayout.textAlign, "center");
    assert.equal(rectLayout.verticalAlign, "middle");
    assert.equal(rectLayout.isArrow, false);

    const diamondLayout = getWhiteboardTextEditorLayout(diamond, byId, view);
    assert.equal(diamondLayout.left, (200 + 36) * 1.5 + 40);
    assert.equal(diamondLayout.top, (100 + 28) * 1.5 - 20);
    assert.equal(diamondLayout.width, 72 * 1.5);
    assert.equal(diamondLayout.height, 56 * 1.5);
    assert.equal(diamondLayout.textAlign, "left");
    assert.equal(diamondLayout.verticalAlign, "bottom");

    const textLayout = getWhiteboardTextEditorLayout(textItem, byId, view);
    assert.equal(textLayout.fontSize, 17 * 1.5);
    assert.equal(textLayout.textAlign, "center");
    assert.equal(textLayout.verticalAlign, "middle");

    const frameLayout = getWhiteboardTextEditorLayout(frame, byId, view);
    assert.equal(frameLayout.textAlign, "center");
    assert.equal(frameLayout.verticalAlign, "top");
  });

  it("positions arrow inline editor above the arrow midpoint for center, left, and right alignments", () => {
    const view = { x: 10, y: 20, scale: 2 };
    const a: WhiteboardBoxTextElement = {
      id: IDS.rect,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      text: "A",
      color: "blue",
    };
    const b: WhiteboardBoxTextElement = {
      id: IDS.ellipse,
      type: "rectangle",
      x: 300,
      y: 0,
      width: 100,
      height: 100,
      text: "B",
      color: "blue",
    };
    // Bound edges: (100, 50) -> (300, 50), midpoint = (200, 50)
    const baseArrow: Extract<WhiteboardElement, { type: "arrow" }> = {
      id: IDS.arrow,
      type: "arrow",
      from: { x: 50, y: 50, elementId: IDS.rect },
      to: { x: 350, y: 50, elementId: IDS.ellipse },
      text: "通过",
      color: "purple",
    };
    const byId = new Map<string, WhiteboardElement>([a, b, baseArrow].map((e) => [e.id, e]));

    const centered = getWhiteboardTextEditorLayout(baseArrow, byId, view);
    assert.equal(centered.isArrow, true);
    assert.equal(centered.textAlign, "center");
    assert.equal(centered.verticalAlign, "bottom");
    assert.equal(centered.left, (200 - 100) * 2 + 10);
    assert.equal(centered.width, 200 * 2);
    // Bottom edge of arrow editor box aligns with (midpoint.y - 6) * scale + view.y
    assert.equal(centered.top + centered.height, (50 - 6) * 2 + 20);
    assert.equal(centered.fontSize, 14 * 2);
    assert.equal(centered.lineHeight, 18 * 2);

    const leftAligned = getWhiteboardTextEditorLayout({ ...baseArrow, textAlign: "left" }, byId, view);
    assert.equal(leftAligned.left, (200 + 5) * 2 + 10);

    const rightAligned = getWhiteboardTextEditorLayout({ ...baseArrow, textAlign: "right" }, byId, view);
    assert.equal(rightAligned.left + rightAligned.width, (200 - 5) * 2 + 10);
  });
});

