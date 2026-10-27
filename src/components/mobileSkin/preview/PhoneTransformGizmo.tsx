// Transform handles of the selected clip on the phone preview (the desktop edit mode's gizmo, by
// touch): drag the picture with one finger to move it, pinch with two to scale, twist to rotate.
// The clip's frame and corner knobs show while fingers are on it.
// It snaps to the frame edges, its centre and the composition guides (guide lines show while
// snapped). Every gesture writes the clip's transform through the crop sheet's setPropertyValue
// path (keyframe-aware) inside one owned transaction: lifting the fingers is one undo step, a
// cancelled touch (the system took it) rolls the gesture back exactly. Handles that vanish mid-drag
// (playhead left the clip, sheet opened, unmount) keep the move so far and close the transaction.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { getGuideSnapPoints } from '../../../services/compositionGuides';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { LayerOverlayBounds, OverlayPoint } from '../../preview/editModeOverlayMath';
import { resolvePhoneClipTarget } from '../crop/phoneClipTarget';
import { phoneNodeDrivenTransformKeys, writePhoneTransform } from '../crop/phoneCropCommands';
import { readPhoneTransform, type PhoneTransformKey, type PhoneTransformValues } from '../crop/phoneCropGeometry';
import { createPhoneEditSession, type PhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { insidePhoneBounds, readPhoneClipBounds } from './phoneClipProjection';
import type { PhoneRect } from './phonePreviewGeometry';
import { PHONE_PREVIEW_VIEW_TEST_IDS as IDS } from './phonePreviewViewIds';
import { usePhonePreviewViewStore } from './phonePreviewViewStore';
import { usePhoneGizmoAbandonGuard } from './usePhoneGizmoAbandonGuard';
import { resolvePhoneGizmo, type PhoneGizmoStart } from './phoneTransformGizmoMath';

/** Finger slack around the picture and the snap distance, in CSS pixels. */
const HIT_MARGIN = 24;
const SNAP_DISTANCE = 8;
const ALL_KEYS: readonly PhoneTransformKey[] = ['position.x', 'position.y', 'scale.all', 'rotation.z'];

interface Gesture {
  clipId: string;
  comp: { width: number; height: number };
  session: PhoneEditSession;
  start: PhoneGizmoStart;
  values: PhoneTransformValues;
  keys: Set<PhoneTransformKey>;
  blocked: Set<PhoneTransformKey>;
  told: boolean;
  snapped: { x: number | null; y: number | null };
}

function readValues(clipId: string, comp: { width: number; height: number }): PhoneTransformValues | null {
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  return readPhoneTransform(state.getInterpolatedTransform(clipId, Math.max(0, state.playheadPosition - clip.startTime)), comp);
}

/** The clip the handles act on, or null (none selected, not visual, locked, or not at the playhead). */
function useGizmoClip(): string | null {
  // Re-render on anything that moves the picture: selection, clips, keyframes, playhead.
  useTimelineStore((state) => state.clips);
  useTimelineStore((state) => state.clipKeyframes);
  useTimelineStore((state) => state.playheadPosition);
  useTimelineStore((state) => state.selectedClipIds);
  useTimelineStore((state) => state.layers);
  const target = resolvePhoneClipTarget();
  if (!target.ok) return null;
  const playhead = useTimelineStore.getState().playheadPosition;
  const { clip } = target;
  if (playhead < clip.startTime || playhead >= clip.startTime + clip.duration) return null;
  return clip.id;
}

export function PhoneTransformGizmo({ rect, compWidth, compHeight }: { rect: PhoneRect; compWidth: number; compHeight: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, OverlayPoint>());
  const [active, setActive] = useState(false);
  const [snapped, setSnapped] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const snapOn = usePhonePreviewViewStore((state) => state.snap);
  const guides = useMediaStore((state) => state.compositions.find((c) => c.id === state.activeCompositionId)?.guides);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const clipId = useGizmoClip();
  const bounds: LayerOverlayBounds | null = clipId ? readPhoneClipBounds(clipId, compWidth, compHeight) : null;
  const liveClipId = clipId && bounds && rect.width > 0 && rect.height > 0 ? clipId : null;

  const write = (gesture: Gesture) => {
    const writable = new Set([...gesture.keys].filter((key) => !gesture.blocked.has(key)));
    return () => writePhoneTransform(gesture.clipId, gesture.values, writable, gesture.comp);
  };

  /** Ends the gesture: keeps the move as one undo step, or rolls it back when the system took the touch. */
  const end = (gesture: Gesture, keep: boolean, mounted: boolean) => {
    pointersRef.current.clear();
    gestureRef.current = null;
    if (!keep) gesture.session.cancel();
    else if (gesture.session.changed) {
      void gesture.session.commit(write(gesture)).then((result) => { if (!result.ok) showToast(result.message, 'error'); });
    } else void gesture.session.commit();
    if (!mounted) return;
    setActive(false);
    setSnapped({ x: null, y: null });
  };
  // The handles can vanish mid-drag (playhead left the clip, selection changed, gizmo unmounted):
  // pointerup then never arrives, so keep the move made so far and close its transaction here.
  usePhoneGizmoAbandonGuard(liveClipId, gestureRef, (reason) => {
    const gesture = gestureRef.current;
    if (gesture) end(gesture, true, reason !== 'unmount');
  });

  if (!clipId || !bounds || !liveClipId) return null;
  /** Composition pixels per CSS pixel. */
  const scale = compWidth / rect.width;

  const toComp = (event: ReactPointerEvent): OverlayPoint | null => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return { x: ((event.clientX - box.left) / box.width) * compWidth, y: ((event.clientY - box.top) / box.height) * compHeight };
  };

  /** Starts a new phase (one or two fingers) from the clip's current state. */
  const rebase = (gesture: Gesture) => {
    const fingers = [...pointersRef.current.values()].slice(0, 2);
    const current = readPhoneClipBounds(gesture.clipId, gesture.comp.width, gesture.comp.height) ?? gesture.start.bounds;
    gesture.start = { values: gesture.values, bounds: current, fingers };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGElement>) => {
    const at = toComp(event);
    if (!at) return;
    const gesture = gestureRef.current;
    if (!gesture) {
      if (!event.isPrimary || !insidePhoneBounds(at, bounds, HIT_MARGIN * scale)) return;
      const values = readValues(clipId, { width: compWidth, height: compHeight });
      const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
      if (!values || !clip) return;
      event.preventDefault();
      event.stopPropagation();
      svgRef.current?.setPointerCapture?.(event.pointerId);
      pointersRef.current.clear();
      pointersRef.current.set(event.pointerId, at);
      gestureRef.current = {
        clipId, comp: { width: compWidth, height: compHeight }, session: createPhoneEditSession('Transform clip'),
        start: { values, bounds, fingers: [at] }, values, keys: new Set(), blocked: phoneNodeDrivenTransformKeys(clip, ALL_KEYS),
        told: false, snapped: { x: null, y: null },
      };
      setActive(true);
      return;
    }
    if (pointersRef.current.size >= 2) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, at);
    rebase(gesture);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !pointersRef.current.has(event.pointerId)) return;
    const at = toComp(event);
    if (!at) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, at);
    const fingers = [...pointersRef.current.values()].slice(0, 2);
    const result = resolvePhoneGizmo(gesture.start, fingers, {
      enabled: snapOn, comp: gesture.comp, guides: getGuideSnapPoints(guides), threshold: SNAP_DISTANCE * scale,
    });
    gesture.values = result.values;
    for (const key of result.keys) gesture.keys.add(key);
    if (!gesture.told && result.keys.some((key) => gesture.blocked.has(key))) {
      gesture.told = true;
      showToast('A node graph drives part of this transform; those values stay as they are.', 'info');
    }
    if (result.snappedX !== gesture.snapped.x || result.snappedY !== gesture.snapped.y) {
      gesture.snapped = { x: result.snappedX, y: result.snappedY };
      setSnapped(gesture.snapped);
    }
    void gesture.session.apply(write(gesture));
  };

  const finish = (event: ReactPointerEvent<SVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    // pointercancel: the system took the touch, so roll the whole gesture back instead of keeping a half move.
    if (event.type === 'pointercancel') { end(gesture, false, true); return; }
    if (pointersRef.current.size > 0) { rebase(gesture); return; }
    // pointerup, or the capture was lost without one: keep the move.
    end(gesture, true, true);
  };

  const { tl, tr, br, bl } = bounds.corners;
  const points = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;
  const stroke = 1.5 * scale;
  const knob = 6 * scale;

  return (
    <svg
      ref={svgRef}
      className="phone-gizmo"
      data-testid={IDS.gizmo}
      data-clip-id={clipId}
      data-gesture={active ? 'true' : 'false'}
      data-snapped-x={snapped.x ?? undefined}
      data-snapped-y={snapped.y ?? undefined}
      viewBox={`0 0 ${compWidth} ${compHeight}`}
      preserveAspectRatio="none"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      role="application"
      aria-label="Clip handles: drag to move, pinch to scale, twist to rotate"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {active ? <rect className="phone-gizmo__catcher" x={-compWidth} y={-compHeight} width={compWidth * 3} height={compHeight * 3} /> : null}
      <polygon className="phone-gizmo__hit" points={points} strokeWidth={HIT_MARGIN * 2 * scale} />
      {/* The frame shows while fingers are on the clip; at rest the picture stays clean (and touchable). */}
      {active ? (
        <>
          <polygon className="phone-gizmo__box" data-testid={IDS.gizmoBox} points={points} strokeWidth={stroke}
            data-corners={JSON.stringify([tl, tr, br, bl].map((p) => [Math.round(p.x), Math.round(p.y)]))} />
          {[tl, tr, br, bl].map((corner, index) => (
            <circle key={index} className="phone-gizmo__knob" cx={corner.x} cy={corner.y} r={knob} strokeWidth={stroke} />
          ))}
        </>
      ) : null}
      {snapped.x !== null ? <line className="phone-gizmo__snap" x1={snapped.x} x2={snapped.x} y1={0} y2={compHeight} strokeWidth={stroke} /> : null}
      {snapped.y !== null ? <line className="phone-gizmo__snap" x1={0} x2={compWidth} y1={snapped.y} y2={snapped.y} strokeWidth={stroke} /> : null}
    </svg>
  );
}
