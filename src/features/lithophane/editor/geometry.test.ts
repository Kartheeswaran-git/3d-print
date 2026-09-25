import { describe, expect, it } from "vitest";
import type { FlatShape, ShapeParams } from "@/lib/geometry/types";
import { decalCentre, photoOutline, type Domain } from "@/lib/image/project";
import { DEFAULTS, type LithophaneSettings } from "../settings";
import {
  cursorFor,
  describeLayout,
  diffPatch,
  dragPatch,
  editorView,
  frontToScreen,
  hitTest,
  keyPatch,
  layoutHint,
  moonDisc,
  outlinePaths,
  photoAspectFor,
  photoContains,
  photoGeometry,
  pinchPatch,
  ROTATE_HANDLE_OFFSET,
  sameDomain,
  samePatch,
  screenToPiece,
  wheelScale,
  wheelZoomFactor,
  type DragStart,
  type EditorTarget,
  type EditorView,
  type HitScene,
  type Point,
} from "./geometry";

const DEG = Math.PI / 180;

function shape(kind: FlatShape, extra: Partial<ShapeParams> = {}): ShapeParams {
  return { shape: kind, crescent: 0.4, outerRadius: 0.9, innerRadius: 0.82, offsetX: 0.36, offsetY: 0, rotationDeg: 0, ...extra };
}

function flat(kind: FlatShape = "rectangle", widthMm = 100, heightMm = 100, extra: Partial<ShapeParams> = {}): Extract<Domain, { kind: "flat" }> {
  return { kind: "flat", widthMm, heightMm, shape: shape(kind, extra) };
}

const SPHERE: Domain = { kind: "sphere", openingDeg: 22 };

const settings = (patch: Partial<LithophaneSettings> = {}): LithophaneSettings => ({
  ...DEFAULTS,
  cropRatio: "1:1",
  ...patch,
});

function view(domain: Domain, width = 600, height = 500): EditorView {
  const v = editorView(domain, { width, height });
  if (!v) throw new Error("no view");
  return v;
}

const close = (a: Point, b: Point, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

function scene(v: EditorView, s: LithophaneSettings, aspect: number | null, moonOn = true): HitScene {
  return { view: v, settings: s, aspect, geometry: aspect === null ? null : photoGeometry(v, s, aspect), moonOn };
}

describe("editorView", () => {
  it("fits a flat piece at its aspect inside the insets, centred", () => {
    const v = editorView(flat("rectangle", 100, 50), { width: 600, height: 400 });
    expect(v?.kind).toBe("flat");
    if (v?.kind !== "flat") return;
    // Insets: 32 left/right, top min(44, 48), bottom min(52, 48).
    expect(v.frame).toEqual({ left: 32, top: 64, width: 536, height: 268 });
  });

  it("fits the sphere as a square disc", () => {
    const v = editorView(SPHERE, { width: 800, height: 500 });
    expect(v?.kind).toBe("sphere");
    if (v?.kind !== "sphere") return;
    expect(v.frame.width).toBe(v.frame.height);
    expect(v.frame.height).toBe(500 - 44 - 52);
    expect(v.radius).toBe(v.frame.width / 2);
    expect(v.cx).toBe(v.frame.left + v.radius);
    expect(v.cx).toBeCloseTo(400, 0);
    expect(v.openingDeg).toBe(22);
  });

  it("returns null when there is no room or no size", () => {
    expect(editorView(SPHERE, { width: 0, height: 300 })).toBeNull();
    expect(editorView(SPHERE, { width: 20, height: 20 })).toBeNull();
    expect(editorView(flat("rectangle", 0, 50), { width: 400, height: 400 })).toBeNull();
  });

  it("maps screen points back to piece coords", () => {
    const v = view(flat("rectangle", 100, 50));
    if (v.kind !== "flat") throw new Error();
    const { left, top, width, height } = v.frame;
    expect(screenToPiece(v, { x: left + width / 4, y: top + height })).toEqual({ u: 0.25, v: 1 });
  });
});

describe("photoGeometry", () => {
  it("puts the flat corners where photoOutline puts them", () => {
    const domain = flat("heart", 120, 80);
    const v = view(domain);
    if (v.kind !== "flat") throw new Error();
    const s = settings({ imageScale: 50, imageX: 10, imageY: -20, rotation: 30 });
    const aspect = 1.5;
    const g = photoGeometry(v, s, aspect);
    const { points } = photoOutline(domain, s, aspect, 1);
    const px = ([u, vv]: [number, number]) => ({ x: v.frame.left + u * v.frame.width, y: v.frame.top + vv * v.frame.height });
    close(g.corners.tl.at, px(points[0]));
    close(g.corners.tr.at, px(points[1]));
    close(g.corners.br.at, px(points[2]));
    close(g.corners.bl.at, px(points[3]));
    expect(Object.values(g.corners).every((c) => c.visible)).toBe(true);
    close(g.centre.at, { x: v.frame.left + 0.6 * v.frame.width, y: v.frame.top + 0.3 * v.frame.height });
  });

  it("puts the flat rotation handle above the top edge, turning with the photo", () => {
    const v = view(flat());
    if (v.kind !== "flat") throw new Error();
    const g = photoGeometry(v, settings({ imageScale: 40 }), 1);
    const topY = g.centre.at.y - (0.4 * v.frame.width) / 2;
    close(g.rotate.anchor, { x: g.centre.at.x, y: topY });
    close(g.rotate.at, { x: g.centre.at.x, y: topY - ROTATE_HANDLE_OFFSET });

    const turned = photoGeometry(v, settings({ imageScale: 40, rotation: 90 }), 1);
    // A quarter turn clockwise: "up" now points right on screen.
    expect(turned.rotate.at.x).toBeCloseTo(turned.centre.at.x + (0.4 * v.frame.width) / 2 + ROTATE_HANDLE_OFFSET, 6);
    expect(turned.rotate.at.y).toBeCloseTo(turned.centre.at.y, 6);
  });

  it("puts the sphere corners where photoOutline puts them", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    for (const patch of [{}, { imageX: 20, imageY: -10, rotation: 25, imageScale: 45 }, { imageX: -35, imageY: 30, rotation: -60 }]) {
      const s = settings(patch);
      const aspect = 4 / 3;
      const g = photoGeometry(v, s, aspect);
      const n = 4;
      const { points } = photoOutline(SPHERE, s, aspect, n);
      const at = (k: number) => frontToScreen(v, points[k][0], points[k][1]);
      close(g.corners.tl.at, at(0));
      close(g.corners.tr.at, at(n));
      close(g.corners.br.at, at(2 * n));
      close(g.corners.bl.at, at(3 * n));
    }
  });

  it("centres a centred sphere decal on the disc with the handle straight above", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    const g = photoGeometry(v, settings({ imageScale: 50 }), 1);
    close(g.centre.at, { x: v.cx, y: v.cy });
    expect(g.centre.visible).toBe(true);
    // Top-edge middle: front view (0, 0.5).
    close(g.rotate.anchor, { x: v.cx, y: v.cy - 0.5 * v.radius });
    close(g.rotate.at, { x: v.cx, y: v.cy - 0.5 * v.radius - ROTATE_HANDLE_OFFSET });
    expect(g.rotate.visible).toBe(true);
  });

  it("hides the sphere handles when the photo is on the back", () => {
    const v = view(SPHERE);
    const g = photoGeometry(v, settings({ imageX: 100, imageScale: 40 }), 1);
    expect(g.centre.visible).toBe(false);
    expect(g.rotate.visible).toBe(false);
    expect(Object.values(g.corners).some((c) => c.visible)).toBe(false);
  });

  it("keeps corners beyond the decal's hemisphere as handles outside the disc", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    const g = photoGeometry(v, settings({ imageScale: 150 }), 1);
    const tr = g.corners.tr;
    expect(tr.visible).toBe(true);
    close(tr.at, frontToScreen(v, 1.5, 1.5));
  });
});

describe("photoAspectFor", () => {
  it("is the crop aspect, 1:1 for the sphere's model crop, and null without a photo", () => {
    expect(photoAspectFor(flat(), settings({ cropRatio: "original" }), { width: 400, height: 300 })).toBeCloseTo(4 / 3);
    expect(photoAspectFor(flat("rectangle", 150, 100), settings({ cropRatio: "model" }), { width: 400, height: 300 })).toBeCloseTo(1.5);
    expect(photoAspectFor(SPHERE, settings({ cropRatio: "model" }), { width: 400, height: 300 })).toBeCloseTo(1);
    expect(photoAspectFor(SPHERE, settings(), null)).toBeNull();
  });
});

describe("hitTest", () => {
  it("finds the rotation handle, corners, the photo and the moon (flat)", () => {
    const v = view(flat());
    const s = settings({ imageScale: 50 });
    const sc = scene(v, s, 1);
    const g = sc.geometry!;
    expect(hitTest(sc, g.centre.at, 10)).toBe("move");
    expect(hitTest(sc, { x: g.corners.tl.at.x - 4, y: g.corners.tl.at.y + 3 }, 10)).toBe("scale-tl");
    expect(hitTest(sc, g.corners.br.at, 10)).toBe("scale-br");
    expect(hitTest(sc, g.rotate.at, 10)).toBe("rotate");
    expect(hitTest(sc, { x: 2, y: 2 }, 10)).toBe("moon");
    expect(hitTest({ ...sc, moonOn: false }, { x: 2, y: 2 }, 10)).toBeNull();
    expect(hitTest({ ...sc, moonOn: false }, g.centre.at, 10)).toBe("move");
  });

  it("turns the moon anywhere without a photo", () => {
    const v = view(flat());
    const sc = scene(v, settings(), null);
    expect(hitTest(sc, { x: 300, y: 250 }, 10)).toBe("moon");
    expect(hitTest({ ...sc, moonOn: false }, { x: 300, y: 250 }, 10)).toBeNull();
  });

  it("follows the rotated photo (flat)", () => {
    const v = view(flat());
    if (v.kind !== "flat") throw new Error();
    const s = settings({ imageScale: 60, rotation: 45 });
    const g = photoGeometry(v, s, 3);
    // A long, thin photo turned 45°: a point along its diagonal axis is inside, the same distance across is not.
    const along = { x: g.centre.at.x + 60, y: g.centre.at.y + 60 };
    const across = { x: g.centre.at.x + 60, y: g.centre.at.y - 60 };
    expect(photoContains(v, s, 3, along)).toBe(true);
    expect(photoContains(v, s, 3, across)).toBe(false);
  });

  it("tests the decal on the sphere", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    const s = settings({ imageScale: 40, imageX: 20 });
    const sc = scene(v, s, 1);
    const g = sc.geometry!;
    expect(hitTest(sc, g.centre.at, 10)).toBe("move");
    expect(hitTest(sc, frontToScreen(v, -0.8, 0), 10)).toBe("moon");
    expect(hitTest(sc, { x: 1, y: 1 }, 10)).toBe("moon");
    expect(photoContains(v, s, 1, frontToScreen(v, -0.8, 0))).toBe(false);
  });
});

describe("cursorFor", () => {
  it("picks cursors by target and corner direction", () => {
    const v = view(flat());
    const g = photoGeometry(v, settings({ imageScale: 50 }), 1);
    expect(cursorFor(null, g, false)).toBe("default");
    expect(cursorFor("move", g, false)).toBe("move");
    expect(cursorFor("moon", g, false)).toBe("grab");
    expect(cursorFor("moon", g, true)).toBe("grabbing");
    expect(cursorFor("rotate", g, false)).toBe("crosshair");
    expect(cursorFor("scale-tl", g, false)).toBe("nwse-resize");
    expect(cursorFor("scale-br", g, false)).toBe("nwse-resize");
    expect(cursorFor("scale-tr", g, false)).toBe("nesw-resize");
    const turned = photoGeometry(v, settings({ imageScale: 50, rotation: 45 }), 1);
    expect(cursorFor("scale-tl", turned, false)).toBe("ns-resize");
  });
});

describe("moonDisc", () => {
  it("uses the outer radius for circles and crescents, and turns with moonRotation", () => {
    const domain = flat("circle", 100, 100, { outerRadius: 0.9 });
    const v = view(domain, 464, 504); // frame 400 × 400
    if (v.kind !== "flat") throw new Error();
    expect(v.frame.width).toBe(400);
    const disc = moonDisc(v, domain, 90);
    // One normalised unit = 50 mm = 200 px.
    expect(disc.radius).toBeCloseTo(180);
    close(disc.east, { x: 0, y: 1 });
  });

  it("covers other shapes and keeps rectangles unrotated", () => {
    const domain = flat("rectangle", 200, 100);
    const v = view(domain);
    if (v.kind !== "flat") throw new Error();
    const disc = moonDisc(v, domain, 40);
    const unit = (50 * v.frame.width) / 200;
    expect(disc.radius).toBeCloseTo(Math.hypot(2, 1) * unit);
    close(disc.east, { x: 1, y: 0 });
  });

  it("is the sphere's disc", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    expect(moonDisc(v, SPHERE, 30)).toEqual({ radius: v.radius, east: { x: 1, y: 0 } });
  });
});

describe("dragPatch", () => {
  const start = (target: EditorTarget, pointer: Point, centre: Point, s: LithophaneSettings = settings()): DragStart => ({
    target,
    pointer,
    centre,
    settings: { imageScale: s.imageScale, imageX: s.imageX, imageY: s.imageY, rotation: s.rotation, moonLongitude: s.moonLongitude },
  });

  it("moves a flat photo by the pointer delta in % of the piece", () => {
    const v = view(flat("rectangle", 200, 100));
    if (v.kind !== "flat") throw new Error();
    const st = start("move", { x: 300, y: 250 }, { x: 300, y: 250 }, settings({ imageX: 5 }));
    const p = { x: 300 + 0.1 * v.frame.width, y: 250 - 0.3 * v.frame.height };
    expect(dragPatch(v, null, st, p, false)).toEqual({ imageX: 15, imageY: -30 });
    // Shift keeps the larger axis only.
    expect(dragPatch(v, null, st, p, true)).toEqual({ imageX: 5, imageY: -30 });
  });

  it("clamps flat moves to ±100", () => {
    const v = view(flat());
    const st = start("move", { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(dragPatch(v, null, st, { x: 5000, y: -5000 }, false)).toEqual({ imageX: 100, imageY: -100 });
  });

  it("moves the sphere decal so the grabbed point follows the pointer", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    const st = start("move", { x: v.cx, y: v.cy }, { x: v.cx, y: v.cy });
    // θ = 18° east on the equator → imageX = 18 / 180 · 100 = 10.
    const p = frontToScreen(v, Math.sin(18 * DEG), 0);
    expect(dragPatch(v, null, st, p, false)).toEqual({ imageX: 10, imageY: 0 });
    // 27° north → imageY = −30.
    const up = frontToScreen(v, 0, Math.sin(27 * DEG));
    expect(dragPatch(v, null, st, up, false)).toEqual({ imageX: 0, imageY: -30 });
  });

  it("keeps the sphere decal clear of the opening without a dead zone", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    const st = start("move", { x: v.cx, y: v.cy }, { x: v.cx, y: v.cy });
    const patch = dragPatch(v, null, st, { x: v.cx, y: v.cy + 5 * v.radius }, false);
    // Lowest decal latitude −(90 − 22 − 5) = −63° → imageY = 70.
    expect(patch).toEqual({ imageX: 0, imageY: 70 });
    const c = decalCentre({ imageX: 0, imageY: patch.imageY! }, 22);
    expect(c.phiDeg).toBeCloseTo(-63);
  });

  it("scales about the photo centre", () => {
    const v = view(flat());
    const c = { x: 300, y: 250 };
    const st = start("scale-br", { x: 340, y: 280 }, c, settings({ imageScale: 60 }));
    expect(dragPatch(v, null, st, { x: 380, y: 310 }, false)).toEqual({ imageScale: 120 });
    expect(dragPatch(v, null, st, { x: 420, y: 340 }, false)).toEqual({ imageScale: 150 });
    expect(dragPatch(v, null, st, { x: 302, y: 251 }, false)).toEqual({ imageScale: 10 });
  });

  it("rotates clockwise with the pointer, snapping to 15° with shift", () => {
    const v = view(flat());
    const c = { x: 300, y: 250 };
    const st = start("rotate", { x: 300, y: 150 }, c, settings({ rotation: 10 }));
    expect(dragPatch(v, null, st, { x: 400, y: 250 }, false)).toEqual({ rotation: 100 });
    const near44 = { x: 300 + 100 * Math.sin(44 * DEG), y: 250 - 100 * Math.cos(44 * DEG) };
    expect(dragPatch(v, null, st, near44, false)).toEqual({ rotation: 54 });
    expect(dragPatch(v, null, st, near44, true)).toEqual({ rotation: 60 });
    // Past the bottom wraps into (−180, 180].
    expect(dragPatch(v, null, st, { x: 290, y: 350 }, false).rotation).toBeCloseTo(-164, 0);
  });

  it("turns the moon: the surface follows the pointer", () => {
    const v = view(SPHERE);
    if (v.kind !== "sphere") throw new Error();
    const disc = moonDisc(v, SPHERE, 0);
    const st = start("moon", { x: 200, y: 200 }, { x: 0, y: 0 }, settings({ moonLongitude: 0 }));
    expect(dragPatch(v, disc, st, { x: 200 + v.radius, y: 200 }, false)).toEqual({ moonLongitude: -57 });
    expect(dragPatch(v, disc, st, { x: 200, y: 400 }, false)).toEqual({ moonLongitude: 0 });
    const wrap = start("moon", { x: 200, y: 200 }, { x: 0, y: 0 }, settings({ moonLongitude: 170 }));
    expect(dragPatch(v, disc, wrap, { x: 200 - v.radius, y: 200 }, false)).toEqual({ moonLongitude: -133 });
  });

  it("turns a rotated flat moon disc along its own equator", () => {
    const domain = flat("crescent");
    const v = view(domain);
    const disc = moonDisc(v, domain, 90);
    const st = start("moon", { x: 200, y: 200 }, { x: 0, y: 0 });
    expect(dragPatch(v, disc, st, { x: 400, y: 200 }, false)).toEqual({ moonLongitude: 0 });
    const down = dragPatch(v, disc, st, { x: 200, y: 200 + disc.radius }, false);
    expect(down).toEqual({ moonLongitude: -57 });
  });

  it("does nothing for degenerate starts", () => {
    const v = view(flat());
    const c = { x: 300, y: 250 };
    expect(dragPatch(v, null, start("scale-tl", c, c), { x: 400, y: 400 }, false)).toEqual({});
    expect(dragPatch(v, null, start("rotate", c, c), { x: 400, y: 400 }, false)).toEqual({});
    expect(dragPatch(v, null, start("moon", c, c), { x: 400, y: 400 }, false)).toEqual({});
  });
});

describe("pinchPatch", () => {
  it("scales with finger distance and rotates with their angle", () => {
    const st = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, imageScale: 50, rotation: 0 };
    expect(pinchPatch(st, { x: 0, y: 0 }, { x: 200, y: 0 })).toEqual({ imageScale: 100, rotation: 0 });
    const turned = pinchPatch(st, { x: 0, y: 0 }, { x: 100 * Math.cos(30 * DEG), y: 100 * Math.sin(30 * DEG) });
    expect(turned).toEqual({ imageScale: 50, rotation: 30 });
    expect(pinchPatch(st, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({});
  });
});

describe("wheel", () => {
  it("shrinks on scroll down, grows on scroll up, capped per event", () => {
    expect(wheelZoomFactor(10, 0, false)).toBeCloseTo(Math.exp(-0.015));
    expect(wheelZoomFactor(-10, 0, false)).toBeCloseTo(Math.exp(0.015));
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(Math.exp(-48 * 0.0015));
    expect(wheelZoomFactor(500, 0, false)).toBeCloseTo(Math.exp(-0.1));
    expect(wheelZoomFactor(5, 0, true)).toBeCloseTo(Math.exp(-0.05));
    expect(wheelZoomFactor(Number.NaN, 0, false)).toBe(1);
  });

  it("accumulates unrounded sizes within the range", () => {
    let scale = 60;
    for (let i = 0; i < 10; i++) scale = wheelScale(scale, wheelZoomFactor(-2, 0, false));
    expect(scale).toBeGreaterThan(61.5);
    expect(wheelScale(149, 1.5)).toBe(150);
    expect(wheelScale(11, 0.5)).toBe(10);
  });
});

describe("keyPatch", () => {
  const photoOn = { hasPhoto: true, moonOn: true };
  const noPhoto = { hasPhoto: false, moonOn: true };
  const s = settings({ imageX: 5, imageY: -3, imageScale: 60, rotation: 10, moonLongitude: 20 });

  it("nudges, resizes, rotates and centres the photo", () => {
    expect(keyPatch("ArrowRight", false, s, photoOn)).toEqual({ imageX: 6 });
    expect(keyPatch("ArrowLeft", true, s, photoOn)).toEqual({ imageX: -5 });
    expect(keyPatch("ArrowDown", false, s, photoOn)).toEqual({ imageY: -2 });
    expect(keyPatch("ArrowUp", true, s, photoOn)).toEqual({ imageY: -13 });
    expect(keyPatch("+", true, s, photoOn)).toEqual({ imageScale: 62 });
    expect(keyPatch("=", false, s, photoOn)).toEqual({ imageScale: 62 });
    expect(keyPatch("-", false, s, photoOn)).toEqual({ imageScale: 58 });
    expect(keyPatch("[", false, s, photoOn)).toEqual({ rotation: 5 });
    expect(keyPatch("]", false, s, photoOn)).toEqual({ rotation: 15 });
    expect(keyPatch("{", true, s, photoOn)).toEqual({ rotation: -5 });
    expect(keyPatch("}", true, s, photoOn)).toEqual({ rotation: 25 });
    expect(keyPatch("0", false, s, photoOn)).toEqual({ imageX: 0, imageY: 0, rotation: 0 });
  });

  it("turns the moon with , . and, without a photo, the arrows", () => {
    expect(keyPatch(",", false, s, photoOn)).toEqual({ moonLongitude: 25 });
    expect(keyPatch(".", false, s, photoOn)).toEqual({ moonLongitude: 15 });
    expect(keyPatch(">", true, s, photoOn)).toEqual({ moonLongitude: 5 });
    expect(keyPatch("ArrowRight", false, s, noPhoto)).toEqual({ moonLongitude: 15 });
    expect(keyPatch("ArrowLeft", true, s, noPhoto)).toEqual({ moonLongitude: 35 });
    expect(keyPatch(",", false, settings({ moonLongitude: 178 }), noPhoto)).toEqual({ moonLongitude: -177 });
  });

  it("leaves keys it doesn't own alone", () => {
    expect(keyPatch("ArrowUp", false, s, noPhoto)).toBeNull();
    expect(keyPatch("+", false, s, noPhoto)).toBeNull();
    expect(keyPatch("0", false, s, noPhoto)).toBeNull();
    expect(keyPatch(",", false, s, { hasPhoto: true, moonOn: false })).toBeNull();
    expect(keyPatch("ArrowLeft", false, s, { hasPhoto: false, moonOn: false })).toBeNull();
    expect(keyPatch("w", false, s, photoOn)).toBeNull();
    expect(keyPatch("1", false, s, photoOn)).toBeNull();
  });

  it("stays in range at the limits", () => {
    const edge = settings({ imageX: 100, imageScale: 150 });
    expect(keyPatch("ArrowRight", false, edge, photoOn)).toEqual({ imageX: 100 });
    expect(diffPatch(edge, keyPatch("ArrowRight", false, edge, photoOn)!)).toBeNull();
    expect(keyPatch("+", false, edge, photoOn)).toEqual({ imageScale: 150 });
  });
});

describe("patch helpers", () => {
  it("diffs and compares patches", () => {
    const s = settings({ imageX: 4 });
    expect(diffPatch(s, { imageX: 4, imageY: 2 })).toEqual({ imageY: 2 });
    expect(diffPatch(s, { imageX: 4 })).toBeNull();
    expect(samePatch({ imageX: 1, imageY: 2 }, { imageY: 2, imageX: 1 })).toBe(true);
    expect(samePatch({ imageX: 1 }, { imageX: 1, imageY: 2 })).toBe(false);
    expect(samePatch({ imageX: 1 }, { imageX: 2 })).toBe(false);
  });

  it("compares domains by value (mask by identity)", () => {
    expect(sameDomain(flat("heart"), flat("heart"))).toBe(true);
    expect(sameDomain(flat("heart"), flat("heart", 100, 90))).toBe(false);
    expect(sameDomain(flat("heart"), flat("heart", 100, 100, { rotationDeg: 5 }))).toBe(false);
    expect(sameDomain(SPHERE, { kind: "sphere", openingDeg: 22 })).toBe(true);
    expect(sameDomain(SPHERE, { kind: "sphere", openingDeg: 30 })).toBe(false);
    expect(sameDomain(SPHERE, flat())).toBe(false);
    const mask = { width: 2, height: 2, values: new Float32Array(4) };
    expect(sameDomain(flat("custom", 100, 100, { mask }), flat("custom", 100, 100, { mask }))).toBe(true);
    expect(sameDomain(flat("custom", 100, 100, { mask }), flat("custom", 100, 100, { mask: { ...mask } }))).toBe(false);
  });
});

describe("outlinePaths", () => {
  it("draws a flat photo as one closed path", () => {
    const domain = flat();
    const v = view(domain);
    const { solid, hidden } = outlinePaths(v, photoOutline(domain, settings(), 1, 1));
    expect(solid.startsWith("M")).toBe(true);
    expect(solid.endsWith("Z")).toBe(true);
    expect(solid.split("L")).toHaveLength(4);
    expect(hidden).toBe("");
  });

  it("splits the sphere outline into visible and hidden runs", () => {
    const v = view(SPHERE);
    const front = outlinePaths(v, photoOutline(SPHERE, settings({ imageScale: 40 }), 1, 8));
    expect(front.solid).not.toBe("");
    expect(front.hidden).toBe("");
    const edge = outlinePaths(v, photoOutline(SPHERE, settings({ imageScale: 60, imageX: 45 }), 1, 8));
    expect(edge.solid).not.toBe("");
    expect(edge.hidden).not.toBe("");
  });
});

describe("words", () => {
  it("describes the layout", () => {
    const opts = { hasPhoto: true, moonOn: true };
    expect(describeLayout(flat(), settings(), opts)).toBe(
      "Photo 60% of the piece's width, centred, not rotated. The moon shows its near side.",
    );
    expect(describeLayout(SPHERE, settings({ imageX: 12, imageY: -8, rotation: -15, moonLongitude: 30 }), opts)).toBe(
      "Photo 60% of the globe's width, moved 12% right and 8% up, rotated 15° counter-clockwise. The moon is turned to 30° E.",
    );
    expect(describeLayout(SPHERE, settings({ moonLongitude: 180 }), { hasPhoto: false, moonOn: true })).toBe(
      "The moon shows its far side.",
    );
    expect(describeLayout(SPHERE, settings({ imageX: 100 }), { hasPhoto: true, moonOn: false, photoOnBack: true })).toContain(
      "on the back of the globe",
    );
    expect(describeLayout(flat(), settings(), { hasPhoto: false, moonOn: false })).toBe("No photo and no moon texture yet.");
  });

  it("hints at what can be dragged", () => {
    expect(layoutHint({ hasPhoto: true, moonOn: true, photoOnBack: false })).toBe(
      "Drag the photo to move · corners to resize · top handle to rotate · drag the moon to turn it",
    );
    expect(layoutHint({ hasPhoto: true, moonOn: false, photoOnBack: false })).toBe(
      "Drag the photo to move · corners to resize · top handle to rotate",
    );
    expect(layoutHint({ hasPhoto: false, moonOn: true, photoOnBack: false })).toBe("Drag the moon to turn it");
    expect(layoutHint({ hasPhoto: true, moonOn: true, photoOnBack: true })).toContain("back of the globe");
  });
});
