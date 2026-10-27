// Touch drawing surface of the mask pen, laid exactly over the phone preview canvas while the mask
// sheet is in pen mode. Tap adds a point, keep the finger down and drag to pull its curve handles,
// tap the first point to close, drag a point to move it, drag a round handle to bend the curve.
// Points live in the clip's mask space; the projection is the desktop mask overlay's (clip transform,
// source size), so a path drawn here lands where the finger was, also on a moved or scaled clip.
// On a closed path a drag on an edge moves that edge. The sheet's constraint toggles
// (phoneMaskConstraints: lock axis, whole shape, handles only, snap handles, straight edges, align
// neighbours) apply the desktop's modifier-key rules to every drag.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { projectLayerUvToCanvas, unprojectCanvasToLayerUv, type LayerUvProjectionParams } from '../../preview/editModeOverlayMath';
import { getProjectionParams, withClipProjectionTransform } from '../../preview/maskOverlay/maskOverlayProjectionPlans';
import {
  addPhonePenPoint, canClosePhonePenPath, closePhonePenPath, hitPhonePenPoint, setPhonePenHandle,
  type PhonePenPath,
} from './phonePenModel';
import { constrainPhoneEdgeDrag, constrainPhoneHandle, constrainPhonePointDrag, hitPhonePenSegment } from './phoneMaskConstraints';
import { usePhonePenStore } from './phonePenStore';
import { PHONE_MASK_TEST_IDS as IDS } from './phoneMaskTestIds';

interface Point { x: number; y: number }

/** Finger-sized hit radius and drag threshold, in CSS pixels. */
const HIT_RADIUS = 22;
const DRAG_THRESHOLD = 6;

type Gesture =
  | { kind: 'new'; index: number; start: Point; dragged: boolean }
  | { kind: 'move'; index: number; start: Point; startUv: Point; startPath: PhonePenPath; dragged: boolean; closeOnTap: boolean }
  | { kind: 'edge'; index: number; start: Point; startUv: Point; startPath: PhonePenPath; dragged: boolean }
  | { kind: 'handle'; index: number; sign: 1 | -1 };

function readProjection(clipId: string | null, compWidth: number, compHeight: number): LayerUvProjectionParams | null {
  if (!clipId) return null;
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  const layer = state.layers.find((candidate) => candidate?.sourceClipId === clipId) ?? undefined;
  const transform = state.getInterpolatedTransform(clipId, state.playheadPosition - clip.startTime);
  return getProjectionParams(withClipProjectionTransform(layer, transform), compWidth, compHeight);
}

export function PhoneMaskPenOverlay({ width, height, compWidth, compHeight }: { width: number; height: number; compWidth: number; compHeight: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const active = usePhonePenStore((state) => state.active);
  const clipId = usePhonePenStore((state) => state.clipId);
  const path = usePhonePenStore((state) => state.path);
  const selected = usePhonePenStore((state) => state.selected);

  const projection = readProjection(clipId, compWidth, compHeight);
  // Clip uv <-> composition pixels (the SVG's viewBox).
  const toCanvas = (uv: Point): Point => (projection
    ? projectLayerUvToCanvas(uv, projection)
    : { x: uv.x * compWidth, y: uv.y * compHeight });
  const toUv = (canvas: Point): Point => (projection
    ? unprojectCanvasToLayerUv(canvas, projection)
    : { x: canvas.x / compWidth, y: canvas.y / compHeight });

  if (!active || width <= 0 || height <= 0) return null;

  /** Composition pixels per CSS pixel: hit radii and stroke widths are set in CSS pixels. */
  const scale = compWidth / width;

  const eventCanvas = (event: ReactPointerEvent): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * compWidth, y: ((event.clientY - rect.top) / rect.height) * compHeight };
  };
  const update = usePhonePenStore.getState().update;
  const currentPath = (): PhonePenPath => usePhonePenStore.getState().path;

  /** Each segment's cubic in composition pixels (point, out-handle, next in-handle, next point). */
  const segmentCurves = (pathNow: PhonePenPath): [Point, Point, Point, Point][] => {
    const count = pathNow.points.length;
    const last = pathNow.closed ? count : count - 1;
    const curves: [Point, Point, Point, Point][] = [];
    for (let index = 0; index < last; index += 1) {
      const a = pathNow.points[index];
      const b = pathNow.points[(index + 1) % count];
      curves.push([toCanvas(a), toCanvas({ x: a.x + a.handleX, y: a.y + a.handleY }), toCanvas({ x: b.x - b.handleX, y: b.y - b.handleY }), toCanvas(b)]);
    }
    return curves;
  };

  const handleKnobs = (pathNow: PhonePenPath, index: number | null): { index: number; sign: 1 | -1; at: Point }[] => {
    const point = index === null ? undefined : pathNow.points[index];
    if (!point || (point.handleX === 0 && point.handleY === 0)) return [];
    return ([1, -1] as const).map((sign) => ({
      index: index!, sign, at: toCanvas({ x: point.x + sign * point.handleX, y: point.y + sign * point.handleY }),
    }));
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || gestureRef.current) return;
    const at = eventCanvas(event);
    if (!at) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    const pathNow = currentPath();
    const radius = HIT_RADIUS * scale;
    const knobs = handleKnobs(pathNow, usePhonePenStore.getState().selected);
    const knob = hitPhonePenPoint(knobs.map((entry) => entry.at), at, radius);
    if (knob >= 0) {
      gestureRef.current = { kind: 'handle', index: knobs[knob].index, sign: knobs[knob].sign };
      return;
    }
    const projected = pathNow.points.map((point) => toCanvas(point));
    const hit = hitPhonePenPoint(projected, at, radius);
    if (hit >= 0) {
      gestureRef.current = {
        kind: 'move', index: hit, start: at, startUv: toUv(at), startPath: pathNow, dragged: false,
        closeOnTap: hit === 0 && canClosePhonePenPath(pathNow),
      };
      usePhonePenStore.getState().select(hit);
      return;
    }
    if (pathNow.closed) {
      const edge = hitPhonePenSegment(segmentCurves(pathNow), at, radius);
      if (edge >= 0) {
        gestureRef.current = { kind: 'edge', index: edge, start: at, startUv: toUv(at), startPath: pathNow, dragged: false };
        return;
      }
      usePhonePenStore.getState().select(null);
      return;
    }
    const uv = toUv(at);
    update((current) => addPhonePenPoint(current, uv.x, uv.y), pathNow.points.length);
    gestureRef.current = { kind: 'new', index: pathNow.points.length, start: at, dragged: false };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !event.isPrimary) return;
    const at = eventCanvas(event);
    if (!at) return;
    event.preventDefault();
    if (gesture.kind === 'handle') {
      const point = currentPath().points[gesture.index];
      if (!point) return;
      const uv = toUv(at);
      const handle = constrainPhoneHandle({ x: gesture.sign * (uv.x - point.x), y: gesture.sign * (uv.y - point.y) }, usePhonePenStore.getState().constraints);
      update((current) => setPhonePenHandle(current, gesture.index, handle.x, handle.y));
      return;
    }
    if (!gesture.dragged && Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y) < DRAG_THRESHOLD * scale) return;
    gesture.dragged = true;
    const uv = toUv(at);
    if (gesture.kind === 'new') {
      const startUv = toUv(gesture.start);
      update((current) => setPhonePenHandle(current, gesture.index, uv.x - startUv.x, uv.y - startUv.y));
    } else {
      const delta = { x: uv.x - gesture.startUv.x, y: uv.y - gesture.startUv.y };
      const constraints = usePhonePenStore.getState().constraints;
      if (gesture.kind === 'edge') {
        update(() => constrainPhoneEdgeDrag(gesture.startPath, gesture.index, delta, constraints));
        if (svgRef.current) svgRef.current.dataset.rule = 'edge';
      } else {
        const result = constrainPhonePointDrag(gesture.startPath, gesture.index, delta, constraints);
        update(() => result.path);
        if (svgRef.current) svgRef.current.dataset.rule = result.rule;
      }
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !event.isPrimary) return;
    gestureRef.current = null;
    if (event.type === 'pointerup' && gesture.kind === 'move' && gesture.closeOnTap && !gesture.dragged) {
      update(closePhonePenPath, null);
    }
  };

  const projected = path.points.map((point) => toCanvas(point));
  const segment = (from: number, to: number) => {
    const a = path.points[from];
    const b = path.points[to];
    const c1 = toCanvas({ x: a.x + a.handleX, y: a.y + a.handleY });
    const c2 = toCanvas({ x: b.x - b.handleX, y: b.y - b.handleY });
    return `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${projected[to].x} ${projected[to].y}`;
  };
  let d = '';
  if (projected.length > 0) {
    d = `M ${projected[0].x} ${projected[0].y}`;
    for (let index = 1; index < projected.length; index += 1) d += ` ${segment(index - 1, index)}`;
    if (path.closed && projected.length > 1) d += ` ${segment(projected.length - 1, 0)} Z`;
  }
  const knobs = handleKnobs(path, selected);
  const stroke = 2 * scale;

  return (
    <svg
      ref={svgRef}
      className="phone-mask-pen"
      data-testid={IDS.penOverlay}
      data-points={path.points.length}
      data-closed={path.closed ? 'true' : 'false'}
      role="application"
      aria-label="Mask pen: tap to add points"
      viewBox={`0 0 ${compWidth} ${compHeight}`}
      preserveAspectRatio="none"
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {d && <path d={d} className="phone-mask-pen__path" strokeWidth={stroke} fill={path.closed ? 'currentColor' : 'none'} fillOpacity={path.closed ? 0.12 : undefined} />}
      {knobs.map((knob) => (
        <g key={knob.sign}>
          <line x1={projected[knob.index].x} y1={projected[knob.index].y} x2={knob.at.x} y2={knob.at.y} className="phone-mask-pen__arm" strokeWidth={stroke * 0.75} />
          <circle cx={knob.at.x} cy={knob.at.y} r={7 * scale} className="phone-mask-pen__knob" strokeWidth={stroke}
            data-testid={IDS.penHandle} data-index={knob.index} data-sign={knob.sign} />
        </g>
      ))}
      {projected.map((point, index) => (
        <rect key={path.points[index].id} x={point.x - 7 * scale} y={point.y - 7 * scale} width={14 * scale} height={14 * scale}
          className="phone-mask-pen__point" data-first={index === 0 ? 'true' : undefined} data-selected={index === selected ? 'true' : undefined}
          strokeWidth={stroke} data-testid={IDS.penPoint} data-index={index} />
      ))}
    </svg>
  );
}
