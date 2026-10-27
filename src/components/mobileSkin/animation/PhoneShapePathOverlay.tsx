// Finger editing of a motion shape path on the phone preview while the shape path sheet is open.
// Draw mode: one finger stroke becomes a new smooth path. Edit mode: drag a point to move it, tap a
// point to select it and drag its round handles to bend the curve, tap a segment to insert a point
// there (the desktop's curve-preserving split). Points are mapped through the clip's texture box,
// so they land under the finger on a moved, scaled or rotated shape.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { splitPathSegment } from '../../../services/motionDesign/path/splitPathSegment';
import { useTimelineStore } from '../../../stores/timeline';
import type { OverlayPoint } from '../../preview/editModeOverlayMath';
import { hitPhonePenSegment } from '../mask/phoneMaskConstraints';
import { hitPhonePenPoint } from '../mask/phonePenModel';
import type { PhoneRect } from '../preview/phonePreviewGeometry';
import { compToLocal, localToComp, movePhonePathVertex, phonePathSegments, phoneShapeFrame, phoneStrokeToVertices, PHONE_PATH_MAX_VERTICES, type PhoneShapeFrame } from './phoneShapePathModel';
import { usePhoneShapePathStore } from './phoneShapePathStore';
import { PHONE_SHAPE_PATH_TEST_IDS as IDS } from './phoneShapePathTestIds';
import './PhoneShapePath.css';

const HIT_RADIUS = 22;
const DRAG_THRESHOLD = 6;
/** Stroke simplification tolerance in CSS pixels. */
const STROKE_TOLERANCE = 4;

type Gesture =
  | { kind: 'draw'; points: OverlayPoint[] }
  | { kind: 'point'; index: number; start: OverlayPoint; offset: OverlayPoint; dragged: boolean }
  | { kind: 'handle'; index: number; sign: 1 | -1 }
  | { kind: 'segment'; index: number; start: OverlayPoint; dragged: boolean };

function readFrame(clipId: string | null, comp: { width: number; height: number }): PhoneShapeFrame | null {
  if (!clipId) return null;
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip?.motion) return null;
  const t = state.getInterpolatedTransform(clipId, Math.max(0, state.playheadPosition - clip.startTime));
  const all = t.scale.all ?? 1;
  return phoneShapeFrame(clip.motion, {
    position: t.position, scale: { x: t.scale.x * all, y: t.scale.y * all }, rotationRadians: (t.rotation.z * Math.PI) / 180,
  }, comp);
}

export function PhoneShapePathOverlay({ rect, compWidth, compHeight }: { rect: PhoneRect; compWidth: number; compHeight: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [stroke, setStroke] = useState<OverlayPoint[] | null>(null);
  const active = usePhoneShapePathStore((state) => state.active);
  const clipId = usePhoneShapePathStore((state) => state.clipId);
  const mode = usePhoneShapePathStore((state) => state.mode);
  const vertices = usePhoneShapePathStore((state) => state.vertices);
  const closed = usePhoneShapePathStore((state) => state.closed);
  const selected = usePhoneShapePathStore((state) => state.selected);
  useTimelineStore((state) => state.clips);
  useTimelineStore((state) => state.playheadPosition);
  const comp = { width: compWidth, height: compHeight };
  const frame = readFrame(clipId, comp);

  if (!active || !frame || rect.width <= 0 || rect.height <= 0) return null;
  const scale = compWidth / rect.width;
  const store = usePhoneShapePathStore.getState;

  const eventComp = (event: ReactPointerEvent): OverlayPoint | null => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return { x: ((event.clientX - box.left) / box.width) * compWidth, y: ((event.clientY - box.top) / box.height) * compHeight };
  };
  const toLocal = (point: OverlayPoint) => compToLocal(frame, point);
  const toComp = (point: OverlayPoint) => localToComp(frame, point);

  const knobsFor = (index: number | null) => {
    const vertex = index === null ? undefined : store().vertices[index];
    if (!vertex || (vertex.handleOut.x === 0 && vertex.handleOut.y === 0)) return [];
    return ([1, -1] as const).map((sign) => ({ sign, at: toComp({ x: vertex.x + sign * vertex.handleOut.x, y: vertex.y + sign * vertex.handleOut.y }) }));
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || gestureRef.current) return;
    const at = eventComp(event);
    if (!at) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    const { vertices: now, mode: modeNow, selected: selectedNow } = store();
    if (modeNow === 'draw') {
      gestureRef.current = { kind: 'draw', points: [at] };
      setStroke([at]);
      return;
    }
    const radius = HIT_RADIUS * scale;
    const knobs = knobsFor(selectedNow);
    const knob = hitPhonePenPoint(knobs.map((k) => k.at), at, radius);
    if (knob >= 0 && selectedNow !== null) {
      gestureRef.current = { kind: 'handle', index: selectedNow, sign: knobs[knob].sign };
      return;
    }
    const hit = hitPhonePenPoint(now.map((v) => toComp(v)), at, radius);
    if (hit >= 0) {
      const local = toLocal(at);
      gestureRef.current = { kind: 'point', index: hit, start: at, offset: { x: now[hit].x - local.x, y: now[hit].y - local.y }, dragged: false };
      store().select(hit);
      return;
    }
    const segments = phonePathSegments(now, store().closed).map((segment) => segment.map(toComp) as [OverlayPoint, OverlayPoint, OverlayPoint, OverlayPoint]);
    const segment = hitPhonePenSegment(segments, at, radius);
    gestureRef.current = segment >= 0 ? { kind: 'segment', index: segment, start: at, dragged: false } : null;
    if (segment < 0) store().select(null);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !event.isPrimary) return;
    const at = eventComp(event);
    if (!at) return;
    event.preventDefault();
    const { vertices: now, closed: closedNow } = store();
    if (gesture.kind === 'draw') {
      gesture.points.push(at);
      setStroke([...gesture.points]);
      return;
    }
    if (gesture.kind === 'handle') {
      const vertex = now[gesture.index];
      if (!vertex) return;
      const local = toLocal(at);
      const out = { x: gesture.sign * (local.x - vertex.x), y: gesture.sign * (local.y - vertex.y) };
      store().setPath(now.map((v, i) => (i === gesture.index ? { ...v, handleOut: out, handleIn: { x: -out.x, y: -out.y } } : v)), closedNow);
      return;
    }
    if (!gesture.dragged && Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y) < DRAG_THRESHOLD * scale) return;
    gesture.dragged = true;
    if (gesture.kind === 'point') {
      const local = toLocal(at);
      store().setPath(movePhonePathVertex(now, gesture.index, { x: local.x + gesture.offset.x, y: local.y + gesture.offset.y }), closedNow);
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !event.isPrimary) return;
    gestureRef.current = null;
    const cancelled = event.type === 'pointercancel';
    if (gesture.kind === 'draw') {
      setStroke(null);
      if (cancelled || gesture.points.length < 2) return;
      const local = gesture.points.map(toLocal);
      const next = phoneStrokeToVertices(local, (STROKE_TOLERANCE * scale) / Math.max(1e-6, Math.hypot(frame.u.x, frame.u.y)), false);
      if (next.length >= 2) {
        store().setPath(next, false, null);
        store().setMode('edit');
      }
      return;
    }
    if (gesture.kind === 'segment' && !gesture.dragged && !cancelled) {
      const { vertices: now, closed: closedNow } = store();
      if (now.length >= PHONE_PATH_MAX_VERTICES) return;
      store().setPath(splitPathSegment({ vertices: now, closed: closedNow }, gesture.index), closedNow, gesture.index + 1);
    }
  };

  const projected = vertices.map((vertex) => toComp(vertex));
  const segments = phonePathSegments(vertices, closed).map((segment) => segment.map(toComp));
  let d = '';
  if (segments.length > 0) {
    d = `M ${segments[0][0].x} ${segments[0][0].y}`;
    for (const [, c1, c2, b] of segments) d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    if (closed) d += ' Z';
  }
  const knobs = knobsFor(selected);
  const line = 2 * scale;

  return (
    <svg
      ref={svgRef}
      className="phone-shape-path"
      data-testid={IDS.overlay}
      data-mode={mode}
      data-points={vertices.length}
      data-closed={closed ? 'true' : 'false'}
      role="application"
      aria-label={mode === 'draw' ? 'Path: draw with one finger' : 'Path: drag points, tap a segment to add a point'}
      viewBox={`0 0 ${compWidth} ${compHeight}`}
      preserveAspectRatio="none"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {/* A thin dashed guide: the rendered line itself stays visible underneath while editing. */}
      {d ? <path d={d} className="phone-shape-path__line" strokeWidth={line * 0.5} strokeDasharray={`${line * 3} ${line * 3}`} /> : null}
      {stroke && stroke.length > 1 ? (
        <polyline className="phone-shape-path__stroke" points={stroke.map((p) => `${p.x},${p.y}`).join(' ')} strokeWidth={line * 1.5} />
      ) : null}
      {mode === 'edit' && selected !== null && projected[selected] ? knobs.map((knob) => (
        <g key={knob.sign}>
          <line x1={projected[selected].x} y1={projected[selected].y} x2={knob.at.x} y2={knob.at.y} className="phone-shape-path__arm" strokeWidth={line * 0.75} />
          <circle cx={knob.at.x} cy={knob.at.y} r={9 * scale} className="phone-shape-path__knob" strokeWidth={line} data-testid={IDS.handle} data-sign={knob.sign} />
        </g>
      )) : null}
      {mode === 'edit' ? projected.map((point, index) => (
        <rect key={index} x={point.x - 9 * scale} y={point.y - 9 * scale} width={18 * scale} height={18 * scale}
          className="phone-shape-path__point" data-selected={index === selected ? 'true' : undefined}
          strokeWidth={line} data-testid={IDS.point} data-index={index} />
      )) : null}
    </svg>
  );
}
