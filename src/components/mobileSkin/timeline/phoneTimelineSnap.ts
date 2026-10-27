// Snapping for the phone's move and trim gestures, honouring the editor's snapping toggle
// (`snappingEnabled`) and its beat grid (candidates only while a Bars ruler lane exists, exactly
// the editor's rule in positioningUtils.getSnappedPosition). The targets are the editor's: other
// clips' edges (the moving clip and its linked partner excluded), the playhead, markers, the
// timeline start and the grid lines of the chosen division. The capture radius is in screen pixels
// at the PHONE zoom (the desktop zoom is never read), so it feels the same at every pinch level.

import { collectBarsGridSnapTimes } from '../../../timeline/tempo/barsGrid';
import type { TimelineGridSubdivision } from '../../../timeline/tempo/barsGrid';
import type { TempoMap, TimelineClip } from '../../../types/timeline';

/** Capture radius in CSS pixels (a fingertip is wider than a mouse pointer). */
export const PHONE_SNAP_RADIUS_PX = 12;

export interface PhoneSnapContext {
  enabled: boolean;
  clips: readonly Pick<TimelineClip, 'id' | 'startTime' | 'duration' | 'linkedClipId'>[];
  playhead: number;
  markers: readonly { time: number }[];
  /** Phone zoom in pixels per second. */
  zoom: number;
  grid: { tempoMap: TempoMap; subdivision: TimelineGridSubdivision } | null;
}

/** Every snap target for `movingClipId` near the given times. */
export function phoneSnapTargets(context: PhoneSnapContext, movingClipId: string, near: readonly number[]): number[] {
  const moving = context.clips.find((clip) => clip.id === movingClipId);
  const targets = [0, context.playhead, ...context.markers.map((marker) => marker.time)];
  for (const clip of context.clips) {
    if (clip.id === movingClipId || clip.id === moving?.linkedClipId || clip.linkedClipId === movingClipId) continue;
    targets.push(clip.startTime, clip.startTime + clip.duration);
  }
  if (context.grid && context.zoom > 0) {
    const radiusSeconds = PHONE_SNAP_RADIUS_PX / context.zoom;
    for (const time of near) {
      targets.push(...collectBarsGridSnapTimes({
        tempoMap: context.grid.tempoMap, zoom: context.zoom, centerTime: time, radiusSeconds, subdivision: context.grid.subdivision,
      }));
    }
  }
  return targets;
}

function nearest(time: number, targets: readonly number[], radius: number): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  for (const target of targets) {
    const distance = Math.abs(time - target);
    if (distance <= bestDistance) { best = target; bestDistance = distance; }
  }
  return best;
}

/** Snaps a moved clip's start (by its start or end edge); returns the start and the snapped edge. */
export function snapPhoneMoveStart(
  context: PhoneSnapContext,
  clip: Pick<TimelineClip, 'id' | 'duration'>,
  desiredStart: number,
): { startTime: number; snappedTo: number | null } {
  if (!context.enabled || context.zoom <= 0) return { startTime: desiredStart, snappedTo: null };
  const radius = PHONE_SNAP_RADIUS_PX / context.zoom;
  const end = desiredStart + clip.duration;
  const targets = phoneSnapTargets(context, clip.id, [desiredStart, end]);
  const byStart = nearest(desiredStart, targets, radius);
  const byEnd = nearest(end, targets, radius);
  const startDistance = byStart === null ? Infinity : Math.abs(byStart - desiredStart);
  const endDistance = byEnd === null ? Infinity : Math.abs(byEnd - end);
  if (byStart === null && byEnd === null) return { startTime: desiredStart, snappedTo: null };
  if (startDistance <= endDistance) return { startTime: Math.max(0, byStart!), snappedTo: byStart };
  return { startTime: Math.max(0, byEnd! - clip.duration), snappedTo: byEnd };
}

/** Snaps a trimmed edge time; returns the edge and what it snapped to (null when free). */
export function snapPhoneTrimEdge(context: PhoneSnapContext, clipId: string, desiredEdge: number): { edge: number; snappedTo: number | null } {
  if (!context.enabled || context.zoom <= 0) return { edge: desiredEdge, snappedTo: null };
  const target = nearest(desiredEdge, phoneSnapTargets(context, clipId, [desiredEdge]), PHONE_SNAP_RADIUS_PX / context.zoom);
  return target === null ? { edge: desiredEdge, snappedTo: null } : { edge: target, snappedTo: target };
}
