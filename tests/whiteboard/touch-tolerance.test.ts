import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paintWhiteboard } from "@/lib/docs/whiteboard/canvas";
import type { WhiteboardElement } from "@/lib/docs/whiteboard/content";
import {
  hitElement,
  hitsResizeHandle,
  makeArrow,
  makeFigure,
  makeStroke,
  pointerKind,
  pointerTolerance,
  WHITEBOARD_POINTER_TOLERANCE,
} from "@/lib/docs/whiteboard/geometry";

const RECT = "00000000-0000-4000-8000-000000000001";
const PEN = "00000000-0000-4000-8000-000000000002";
const ARROW = "00000000-0000-4000-8000-000000000003";

/** 一条从 (0,0) 到 (200,0) 的水平笔迹：手指落在线外 12px 处 */
const pen = makeStroke(PEN, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], "blue");
const arrow = makeArrow(ARROW, { x: 0, y: 300 }, { x: 200, y: 300 }, "blue");
const rect = makeFigure(RECT, "rectangle", { x: 400, y: 400 }, { x: 560, y: 496 }, "blue");

describe("白板触屏命中容差", () => {
  it("pointerType 映射：touch / pen 各自独立，其余（mouse、空值）按鼠标处理", () => {
    assert.equal(pointerKind("touch"), "touch");
    assert.equal(pointerKind("pen"), "pen");
    assert.equal(pointerKind("mouse"), "mouse");
    assert.equal(pointerKind(""), "mouse");
    assert.equal(pointerKind(undefined), "mouse");
  });

  it("鼠标容差保持原值（桌面端手感不变）", () => {
    assert.equal(pointerTolerance("mouse", 1), 7);
    assert.equal(pointerTolerance("mouse", 1, "bind"), 5);
    assert.equal(pointerTolerance("mouse", 1, "handle"), 4);
    assert.equal(pointerTolerance("mouse", 1, "handleHit"), 7);
  });

  it("触屏容差大于鼠标，并按缩放换算到白板坐标", () => {
    for (const kind of ["hit", "bind", "handle", "handleHit"] as const) {
      assert.ok(WHITEBOARD_POINTER_TOLERANCE.touch[kind] > WHITEBOARD_POINTER_TOLERANCE.mouse[kind], kind);
      assert.ok(WHITEBOARD_POINTER_TOLERANCE.pen[kind] >= WHITEBOARD_POINTER_TOLERANCE.mouse[kind], kind);
    }
    // 缩小到 50% 时，同样的屏幕像素对应两倍的白板距离
    assert.equal(pointerTolerance("touch", 0.5), WHITEBOARD_POINTER_TOLERANCE.touch.hit * 2);
    assert.equal(pointerTolerance("touch", 2), WHITEBOARD_POINTER_TOLERANCE.touch.hit / 2);
  });

  it("细笔迹：线外 12px 鼠标点不中，手指能点中", () => {
    const at = { x: 100, y: 12 };
    assert.equal(hitElement([pen], at, pointerTolerance("mouse", 1)), null);
    assert.equal(hitElement([pen], at, pointerTolerance("touch", 1))?.id, PEN);
  });

  it("连线：线外 12px 鼠标点不中，手指能点中；超出触屏容差仍然点不中", () => {
    assert.equal(hitElement([arrow], { x: 100, y: 312 }, pointerTolerance("mouse", 1)), null);
    assert.equal(hitElement([arrow], { x: 100, y: 312 }, pointerTolerance("touch", 1))?.id, ARROW);
    assert.equal(hitElement([arrow], { x: 100, y: 340 }, pointerTolerance("touch", 1)), null);
  });

  it("图形边缘外的点按容差扩展判定", () => {
    const outside = { x: 400 - 12, y: 440 };
    assert.equal(hitElement([rect], outside, pointerTolerance("mouse", 1)), null);
    assert.equal(hitElement([rect], outside, pointerTolerance("touch", 1))?.id, RECT);
  });

  it("缩放手柄：距右下角 15px 鼠标不触发，手指触发", () => {
    const corner = { x: rect.type === "arrow" ? 0 : rect.x + rect.width, y: rect.type === "arrow" ? 0 : rect.y + rect.height };
    const near = { x: corner.x + 9, y: corner.y + 12 };
    assert.equal(hitsResizeHandle(rect as Exclude<WhiteboardElement, { type: "arrow" }>, near, pointerTolerance("mouse", 1, "handleHit")), false);
    assert.equal(hitsResizeHandle(rect as Exclude<WhiteboardElement, { type: "arrow" }>, near, pointerTolerance("touch", 1, "handleHit")), true);
    // 缩小到 50% 时，白板上相距 7.5 只占屏幕 3.75px，鼠标也能命中
    const zoomedNear = { x: corner.x + 4.5, y: corner.y + 6 };
    assert.equal(hitsResizeHandle(rect as Exclude<WhiteboardElement, { type: "arrow" }>, zoomedNear, pointerTolerance("mouse", 0.5, "handleHit")), true);
  });
});

describe("缩放手柄绘制尺寸", () => {
  function handleRects(handleSize?: number) {
    const rects: [number, number, number, number][] = [];
    const noop = () => {};
    const ctx = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "miter", lineCap: "butt",
      shadowColor: "transparent", shadowBlur: 0, shadowOffsetY: 0, font: "15px system-ui",
      textAlign: "start", textBaseline: "alphabetic",
      save: noop, restore: noop, translate: noop, scale: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, ellipse: noop, roundRect: noop, fill: noop, stroke: noop,
      fillRect: noop, setLineDash: noop, drawImage: noop, fillText: noop,
      measureText: (s: string) => ({ width: s.length * 10 }),
      strokeRect: (x: number, y: number, w: number, h: number) => { rects.push([x, y, w, h]); },
    } as unknown as CanvasRenderingContext2D;
    paintWhiteboard(ctx, [rect], {
      width: 800, height: 600, view: { x: 0, y: 0, scale: 1 }, references: new Map(), images: new Map(),
      selectedId: RECT, showResizeHandle: true, ...(handleSize === undefined ? {} : { handleSize }),
    });
    // 第一个是选中虚线框，第二个是缩放手柄
    return rects[1];
  }

  it("默认（鼠标）手柄 8×8，与改动前一致", () => {
    assert.deepEqual(handleRects().slice(2), [8, 8]);
  });

  it("触屏手柄按 handleSize 放大", () => {
    const size = WHITEBOARD_POINTER_TOLERANCE.touch.handle;
    assert.deepEqual(handleRects(size).slice(2), [size * 2, size * 2]);
  });
});
