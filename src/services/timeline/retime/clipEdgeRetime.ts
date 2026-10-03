import { hasValidWarpPoints, sliceWarp } from './clipWarp';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipTimeRemap, TimelineClip } from '../../../types/timeline';
import type { ClipPlaybackTimingWindow } from '../../../utils/clipPlaybackTiming';
import { createClipSpeedSource, resolveClipSourceTime, type ClipRetimeTiming } from './clipRetime';

type EdgeClip = ClipPlaybackTimingWindow & Pick<ClipRetimeTiming, 'timeRemap' | 'reversed' | 'videoInspectorSections' | 'effects'>;

/** Source-window edge that corresponds to increasing composition time. */
export function isClipSourceReversed(clip: ClipRetimeTiming): boolean {
  return (createClipSpeedSource(clip).speedAt(0) < 0) !== (clip.reversed === true);
}

export function getClipEdgeSourceRate(clip: ClipRetimeTiming): number {
  return Math.abs(createClipSpeedSource(clip).speedAt(0));
}

/** Move a timeline edge by delta seconds. Negative deltas may extend the window.
 * Constant clips use the same signed speed and inspector bypass as playback.
 * Keyframe anchoring stays with the caller's existing atomic edit operation;
 * external speed ramps require a separate rebased-integral edit contract.
 */
export function trimClipSourceEdge(clip: EdgeClip, edge: 'start' | 'end', delta: number):
  { inPoint?: number; outPoint?: number; timeRemap?: ClipTimeRemap } {
  if (clip.timeRemap?.kind === 'freeze') return { inPoint: clip.inPoint, outPoint: clip.outPoint };
  if (clip.timeRemap?.kind === 'warp' && hasValidWarpPoints(clip.timeRemap.points)) return {
    inPoint: clip.inPoint, outPoint: clip.outPoint,
    ...(edge === 'start' && delta !== 0 ? { timeRemap: sliceWarp(clip.timeRemap.points, delta) } : {}),
  };
  if (clip.timeRemap?.kind === 'loop') return edge === 'start'
    ? splitClipSourceWindow(clip, delta, clip.duration) : { inPoint: clip.inPoint, outPoint: clip.outPoint };
  const rate = getClipEdgeSourceRate(clip);
  const sourceDelta = delta * rate;
  const reverse = isClipSourceReversed(clip);
  return edge === 'start'
    ? reverse ? { outPoint: clip.outPoint - sourceDelta } : { inPoint: clip.inPoint + sourceDelta }
    : reverse ? { inPoint: clip.inPoint - sourceDelta } : { outPoint: clip.outPoint + sourceDelta };
}

/** Preserve exact constant-speed samples, including negative speed XOR Reverse.
 * Existing keyframe partitioning cannot represent an arbitrary rebased speed
 * integral (especially sign changes); leave its legacy source windows intact.
 */
export function splitClipSourceWindow(
  clip: ClipRetimeTiming,
  localStart: number,
  localEnd: number,
  keyframes: readonly Keyframe[] = clip.keyframes ?? [],
  preserveLegacyOuterBounds = false,
): { inPoint: number; outPoint: number; timeRemap?: ClipTimeRemap } {
  if (clip.timeRemap?.kind === 'freeze') return { inPoint: clip.inPoint, outPoint: clip.outPoint };
  if (clip.timeRemap?.kind === 'warp' && hasValidWarpPoints(clip.timeRemap.points)) return {
    inPoint: clip.inPoint, outPoint: clip.outPoint, timeRemap: sliceWarp(clip.timeRemap.points, localStart, localEnd),
  };
  if (clip.timeRemap?.kind === 'loop') {
    const source = createClipSpeedSource(clip, keyframes);
    const phase = (Number.isFinite(clip.timeRemap.phase) ? clip.timeRemap.phase! : 0) + source.integrate(localStart);
    const cycle = clip.outPoint - clip.inPoint;
    return { inPoint: clip.inPoint, outPoint: clip.outPoint,
      timeRemap: { kind: 'loop', phase: cycle > 0 ? ((phase % cycle) + cycle) % cycle : 0 } };
  }
  if (keyframes.some(key => key.property === 'speed') || clip.transitionSourceMap ||
      Number.isFinite(clip.transitionSourceTimeOverride) || clip.transitionSourceHold) {
    return { inPoint: clip.inPoint + localStart,
      outPoint: preserveLegacyOuterBounds && localEnd === clip.duration
        ? clip.outPoint : clip.inPoint + localEnd };
  }
  const start = resolveClipSourceTime(clip, localStart).sourceTime;
  const end = resolveClipSourceTime(clip, localEnd).sourceTime;
  return { inPoint: Math.min(start, end), outPoint: Math.max(start, end) };
}

/** Loop parts retain the entire speed curve, including handles outside the part.
 * Partitioning only keys inside a piece would change its integrated source clock.
 */
export function copyLoopSpeedKeyframesToParts(
  keys: Map<string, Keyframe[]>, before: TimelineClip, parts: readonly TimelineClip[],
): Map<string, Keyframe[]> {
  if (before.timeRemap?.kind !== 'loop') return keys;
  const source = (keys.get(before.id) ?? []).filter(key => key.property === 'speed');
  if (!source.length) return keys;
  const result = new Map(keys);
  for (const part of parts) {
    const delta = part.startTime - before.startTime;
    result.set(part.id, [...(keys.get(part.id) ?? []).filter(key => key.property !== 'speed'),
      ...source.map(key => ({ ...structuredClone(key), id: `kf-${crypto.randomUUID()}`,
        clipId: part.id, time: key.time - delta }))].toSorted((a, b) => a.time - b.time));
  }
  return result;
}
