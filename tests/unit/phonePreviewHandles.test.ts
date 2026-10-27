// G3 on-preview handles: the pure math behind the phone transform gizmo, the preview's fit / actual
// pixels layout, the mask point constraints (desktop modifier rules by touch) and the shape path
// editor's projection and stroke simplification.
import { describe, expect, it } from 'vitest';

import { calculateLayerOverlayBounds } from '../../src/components/preview/editModeOverlayMath';
import { buildMaskEdgeDragUpdates } from '../../src/components/preview/maskEdgeDragMath';
import { resolvePhoneGizmo } from '../../src/components/mobileSkin/preview/phoneTransformGizmoMath';
import { clampPhonePan, phoneCanvasRect } from '../../src/components/mobileSkin/preview/phonePreviewGeometry';
import {
  constrainPhoneEdgeDrag, constrainPhoneHandle, constrainPhonePointDrag, NO_PHONE_PEN_CONSTRAINTS, phoneShapeToPenPath,
} from '../../src/components/mobileSkin/mask/phoneMaskConstraints';
import { defaultPhoneMaskParams } from '../../src/components/mobileSkin/mask/phoneMaskGeometry';
import type { PhonePenPath } from '../../src/components/mobileSkin/mask/phonePenModel';
import {
  compToLocal, localToComp, phoneShapeFrame, phoneStrokeToVertices, simplifyPhoneStroke,
} from '../../src/components/mobileSkin/animation/phoneShapePathModel';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import type { PhoneTransformValues } from '../../src/components/mobileSkin/crop/phoneCropGeometry';

const COMP = { width: 1080, height: 1920 };
const VALUES: PhoneTransformValues = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
const BOUNDS = calculateLayerOverlayBounds({
  sourceWidth: 360, sourceHeight: 640, outputWidth: COMP.width, outputHeight: COMP.height, canvasWidth: COMP.width, canvasHeight: COMP.height,
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
});
const NO_SNAP = { enabled: false, comp: COMP, guides: { x: [], y: [] }, threshold: 10 };

describe('phone transform gizmo math', () => {
  it('moves the clip by the finger delta in composition pixels', () => {
    const result = resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: [{ x: 500, y: 900 }] }, [{ x: 620, y: 860 }], NO_SNAP);
    expect(result.values.x).toBeCloseTo(120);
    expect(result.values.y).toBeCloseTo(-40);
    expect(result.keys).toEqual(['position.x', 'position.y']);
  });

  it('pinch scales by the finger gap ratio and a twist rotates against the screen angle', () => {
    const start = [{ x: 400, y: 960 }, { x: 600, y: 960 }];
    const pinched = resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: start }, [{ x: 300, y: 960 }, { x: 700, y: 960 }], NO_SNAP);
    expect(pinched.values.scale).toBeCloseTo(2);
    expect(pinched.values.x).toBeCloseTo(0);
    // Clockwise on screen (second finger moves down) = negative rotation.z (counter-clockwise positive).
    const twisted = resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: start }, [{ x: 500, y: 860 }, { x: 500, y: 1060 }], NO_SNAP);
    expect(twisted.values.rotation).toBeCloseTo(-90);
    expect(twisted.values.scale).toBeCloseTo(1);
    expect(twisted.keys).toContain('rotation.z');
  });

  it('snaps a moved box edge or centre to the frame and to guides, and says where', () => {
    const snap = { enabled: true, comp: COMP, guides: { x: [700], y: [] }, threshold: 10 };
    // Centre starts at 540; a 6 px move stays within 10 px of the centre line, so it snaps back to it.
    const centre = resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: [{ x: 540, y: 960 }] }, [{ x: 546, y: 960 }], snap);
    expect(centre.values.x).toBeCloseTo(0);
    expect(centre.snappedX).toBe(540);
    // Right edge at 720 + (-25) = 695 snaps to the guide at 700.
    const guide = resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: [{ x: 540, y: 960 }] }, [{ x: 515, y: 960 }], snap);
    expect(guide.values.x).toBeCloseTo(-20);
    expect(guide.snappedX).toBe(700);
    const free = resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: [{ x: 540, y: 960 }] }, [{ x: 515, y: 960 }], NO_SNAP);
    expect(free.values.x).toBeCloseTo(-25);
    expect(free.snappedX).toBeNull();
  });

  it('snaps rotation to quarter turns within four degrees', () => {
    const snap = { enabled: true, comp: COMP, guides: { x: [], y: [] }, threshold: 10 };
    const start = [{ x: 400, y: 960 }, { x: 600, y: 960 }];
    const angle = (deg: number) => [{ x: 500 - 100 * Math.cos(deg * Math.PI / 180), y: 960 - 100 * Math.sin(deg * Math.PI / 180) }, { x: 500 + 100 * Math.cos(deg * Math.PI / 180), y: 960 + 100 * Math.sin(deg * Math.PI / 180) }]
    expect(resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: start }, angle(3), snap).values.rotation).toBe(0);
    expect(resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: start }, angle(3), snap).rotationSnapped).toBe(true);
    expect(resolvePhoneGizmo({ values: VALUES, bounds: BOUNDS, fingers: start }, angle(10), snap).values.rotation).toBeCloseTo(-10);
  });
});

describe('phone preview layout', () => {
  it('fits the composition, or shows it at actual pixels with a clamped pan', () => {
    expect(phoneCanvasRect({ width: 400, height: 300 }, COMP, false, { x: 0, y: 0 })).toEqual({ x: 116, y: 0, width: 168, height: 300 });
    const actual = phoneCanvasRect({ width: 400, height: 300 }, COMP, true, { x: 50, y: 0 });
    expect(actual.width).toBe(1080);
    expect(actual.x).toBe((400 - 1080) / 2 + 50);
    expect(clampPhonePan({ x: 10_000, y: -10_000 }, { width: 1080, height: 1920 }, { width: 400, height: 300 })).toEqual({ x: 440, y: -885 });
  });
});

const square: PhonePenPath = {
  points: [
    { id: 'p1', x: 0.3, y: 0.3, handleX: 0, handleY: 0 },
    { id: 'p2', x: 0.7, y: 0.3, handleX: 0, handleY: 0 },
    { id: 'p3', x: 0.7, y: 0.7, handleX: 0, handleY: 0 },
    { id: 'p4', x: 0.3, y: 0.7, handleX: 0, handleY: 0 },
  ],
  closed: true,
  nextId: 5,
};

describe('phone mask point constraints (desktop modifier rules by touch)', () => {
  it('Lock axis keeps only the dominant direction of a point move', () => {
    const { path, rule } = constrainPhonePointDrag(square, 2, { x: 0.1, y: 0.02 }, { ...NO_PHONE_PEN_CONSTRAINTS, axisLock: true });
    expect(rule).toBe('axis');
    expect(path.points[2].x).toBeCloseTo(0.8);
    expect(path.points[2].y).toBe(0.7);
  });

  it('Whole shape keeps a rectangle a rectangle (desktop angle-locked quad)', () => {
    const { path, rule } = constrainPhonePointDrag(square, 2, { x: 0.1, y: 0.05 }, { ...NO_PHONE_PEN_CONSTRAINTS, wholeShape: true });
    expect(rule).toBe('rectangle');
    const [a, b, c, d] = path.points;
    expect(a).toMatchObject({ x: 0.3, y: 0.3 });
    expect(b.y).toBeCloseTo(0.3);
    expect(b.x).toBeCloseTo(0.8);
    expect(c.x).toBeCloseTo(0.8);
    expect(c.y).toBeCloseTo(0.75);
    expect(d.x).toBeCloseTo(0.3);
    expect(d.y).toBeCloseTo(0.75);
  });

  it('Whole shape keeps an ellipse an ellipse (desktop ellipse resize)', () => {
    const circle = phoneShapeToPenPath('circle', defaultPhoneMaskParams('circle', 1), 1)!;
    expect(circle.points).toHaveLength(4);
    const right = circle.points[1];
    const { path, rule } = constrainPhonePointDrag(circle, 1, { x: 0.1, y: 0 }, { ...NO_PHONE_PEN_CONSTRAINTS, wholeShape: true });
    expect(rule).toBe('ellipse');
    // The opposite (left) point stays, the centre moves half the way, the handles stay mirrored.
    expect(path.points[3].x).toBeCloseTo(circle.points[3].x);
    expect(path.points[1].x).toBeCloseTo(right.x + 0.1);
  });

  it('Handles only scales the curve handles and keeps the point', () => {
    const curved = { ...square, points: square.points.map((p, i) => (i === 0 ? { ...p, handleX: 0.1, handleY: 0 } : p)) };
    const { path, rule } = constrainPhonePointDrag(curved, 0, { x: 0.2, y: 0.3 }, { ...NO_PHONE_PEN_CONSTRAINTS, handlesOnly: true });
    expect(rule).toBe('handles');
    expect(path.points[0]).toMatchObject({ x: 0.3, y: 0.3 });
    expect(path.points[0].handleX).toBeCloseTo(0.2);
  });

  it('Snap handles rounds a handle to 45 degree steps', () => {
    const snapped = constrainPhoneHandle({ x: 0.1, y: 0.09 }, { ...NO_PHONE_PEN_CONSTRAINTS, snapHandles: true });
    expect(snapped.x).toBeCloseTo(snapped.y);
    expect(constrainPhoneHandle({ x: 0.1, y: 0.09 }, NO_PHONE_PEN_CONSTRAINTS)).toEqual({ x: 0.1, y: 0.09 });
  });

  it('edge drags use the desktop rule: straight edges and aligned neighbours', () => {
    const skewed = { ...square, points: square.points.map((p, i) => (i === 1 ? { ...p, y: 0.32 } : p)) };
    const straight = constrainPhoneEdgeDrag(skewed, 0, { x: 0, y: -0.1 }, { ...NO_PHONE_PEN_CONSTRAINTS, straightEdges: true });
    expect(straight.points[0].y).toBeCloseTo(straight.points[1].y);
    const aligned = constrainPhoneEdgeDrag(square, 0, { x: 0.05, y: -0.1 }, { ...NO_PHONE_PEN_CONSTRAINTS, alignNeighbours: true });
    expect(aligned.points[0].x).toBeCloseTo(0.3);
    expect(aligned.points[1].x).toBeCloseTo(0.7);
    expect(aligned.points[0].y).toBeCloseTo(0.2);
    expect(buildMaskEdgeDragUpdates({ vertexA: { id: 'a', x: 0, y: 0 }, vertexB: { id: 'b', x: 1, y: 0.1 }, previousA: null, nextB: null }, 0, 0, true, false)
      .map((u) => u.updates.y)).toEqual([0.05, 0.05]);
  });

  it('turns a rotated rectangle shape into points where it is drawn', () => {
    const params = { ...defaultPhoneMaskParams('rectangle', 1), width: 0.4, height: 0.2, rotation: 90 };
    const path = phoneShapeToPenPath('rectangle', params, 1)!;
    const xs = path.points.map((p) => p.x);
    const ys = path.points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.4);
    expect(phoneShapeToPenPath('linear', defaultPhoneMaskParams('linear', 1), 1)).toBeNull();
  });
});

describe('phone shape path model', () => {
  const motion = createDefaultMotionLayerDefinition('shape', { primitive: 'path', size: { w: 400, h: 200 } });

  it('maps local path pixels to composition pixels and back through the clip transform', () => {
    const frame = phoneShapeFrame(motion, { position: { x: 0.5, y: 0 }, scale: { x: 2, y: 2 }, rotationRadians: 0 }, COMP);
    const at = localToComp(frame, { x: 10, y: 20 });
    expect(at.x).toBeCloseTo(540 + 270 + 20);
    expect(at.y).toBeCloseTo(960 + 40);
    const back = compToLocal(frame, at);
    expect(back.x).toBeCloseTo(10);
    expect(back.y).toBeCloseTo(20);
  });

  it('simplifies a finger stroke and gives smooth mirrored handles', () => {
    const stroke = Array.from({ length: 41 }, (_, i) => ({ x: i * 5, y: i <= 20 ? 0 : (i - 20) * 5 }));
    expect(simplifyPhoneStroke(stroke, 2)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }]);
    const vertices = phoneStrokeToVertices(stroke, 2);
    expect(vertices).toHaveLength(3);
    expect(vertices[0].handleOut).toEqual({ x: 0, y: 0 });
    expect(vertices[1].handleIn.x).toBeCloseTo(-vertices[1].handleOut.x);
    expect(vertices[1].handleOut.x).toBeGreaterThan(0);
  });
});
