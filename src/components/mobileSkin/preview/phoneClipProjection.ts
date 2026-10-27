// Where a clip's picture sits in the composition, computed exactly like the desktop edit-mode
// gizmo (useEditModeOverlay + calculateLayerOverlayBounds): the rendered layer's source size, the
// clip's interpolated transform at the playhead. Points are composition pixels.

import { useTimelineStore } from '../../../stores/timeline';
import { calculateLayerOverlayBounds, type LayerOverlayBounds, type OverlayPoint } from '../../preview/editModeOverlayMath';
import { getLayerSourceSize, withClipProjectionTransform } from '../../preview/maskOverlay/maskOverlayProjectionPlans';
import { getPhoneClipSourceSize } from '../crop/phoneClipTarget';

export function readPhoneClipBounds(clipId: string | null, compWidth: number, compHeight: number): LayerOverlayBounds | null {
  if (!clipId) return null;
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  const transform = state.getInterpolatedTransform(clipId, state.playheadPosition - clip.startTime);
  const layer = state.layers.find((candidate) => candidate?.sourceClipId === clipId) ?? undefined;
  const projected = withClipProjectionTransform(layer, transform);
  const fallback = getPhoneClipSourceSize(clip) ?? { width: compWidth, height: compHeight };
  const source = projected ? getLayerSourceSize(projected, fallback) : fallback;
  const scale = projected?.scale ?? { x: transform.scale.x * (transform.scale.all ?? 1), y: transform.scale.y * (transform.scale.all ?? 1) };
  const rotation = projected
    ? (typeof projected.rotation === 'number' ? projected.rotation : projected.rotation.z)
    : (transform.rotation.z * Math.PI) / 180;
  return calculateLayerOverlayBounds({
    sourceWidth: source.width,
    sourceHeight: source.height,
    outputWidth: compWidth,
    outputHeight: compHeight,
    canvasWidth: compWidth,
    canvasHeight: compHeight,
    position: transform.position,
    scale,
    rotation,
  });
}

/** True when `point` lies inside the (convex) box, grown by `margin` composition pixels. */
export function insidePhoneBounds(point: OverlayPoint, bounds: LayerOverlayBounds, margin = 0): boolean {
  const quad = [bounds.corners.tl, bounds.corners.tr, bounds.corners.br, bounds.corners.bl];
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = quad[index];
    const b = quad[(index + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const cross = ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length;
    if (Math.abs(cross) <= margin) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
