// Session-start snapshot of the format sheet. Every preset or layout tap goes from this exact
// state to the new size in ONE resize, instead of resizing back first: a back-and-forth resize is
// only exact up to floating point (and was not exact at all for layers of unknown size), so taps
// would drift. The snapshot holds plain data only (sizes, transform values, keyframe values).

import { useMediaStore } from '../../../stores/mediaStore';
import type { CompositionResizeLayout } from '../../../stores/mediaStore/slices/composition/resizeTransforms';
import { useTimelineStore } from '../../../stores/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';

export interface PhoneFormatSize { width: number; height: number }

/** The values a composition resize changes: position and scale of each clip and their keyframes. */
const RESIZED_KEYFRAME_PROPERTIES: ReadonlySet<string> = new Set(['position.x', 'position.y', 'scale.x', 'scale.y']);

export interface PhoneFormatSnapshot {
  compId: string;
  size: PhoneFormatSize;
  transforms: ReadonlyMap<string, { position: TimelineClip['transform']['position']; scale: TimelineClip['transform']['scale'] }>;
  keyframeValues: ReadonlyMap<string, number>;
}

/** Snapshot of the active composition, or null when none is open. */
export function capturePhoneFormatSnapshot(): PhoneFormatSnapshot | null {
  const media = useMediaStore.getState();
  const comp = media.compositions.find((candidate) => candidate.id === media.activeCompositionId);
  if (!comp) return null;
  const { clips, clipKeyframes } = useTimelineStore.getState();
  const transforms = new Map(clips.map((clip) => [clip.id, structuredClone({ position: clip.transform.position, scale: clip.transform.scale })]));
  const keyframeValues = new Map<string, number>();
  clipKeyframes.forEach((keys: Keyframe[]) => {
    for (const key of keys) if (RESIZED_KEYFRAME_PROPERTIES.has(key.property)) keyframeValues.set(key.id, key.value);
  });
  return { compId: comp.id, size: { width: comp.width, height: comp.height }, transforms, keyframeValues };
}

function sameSize(a: PhoneFormatSize, b: PhoneFormatSize): boolean {
  return a.width === b.width && a.height === b.height;
}

/** Puts the snapshot's size and the clips' resized values back exactly (absolute, repeatable). */
export function restorePhoneFormatSnapshot(snapshot: PhoneFormatSnapshot): void {
  const media = useMediaStore.getState();
  const comp = media.compositions.find((candidate) => candidate.id === snapshot.compId);
  if (!comp) throw new Error('The composition no longer exists.');
  if (media.activeCompositionId !== snapshot.compId) throw new Error('Another composition was opened meanwhile.');
  // The size change moves clips by its own rule; the snapshot values below replace that result.
  if (!sameSize(comp, snapshot.size)) media.updateComposition(snapshot.compId, { ...snapshot.size }, { resizeLayout: 'pixels' });
  const { clips, clipKeyframes } = useTimelineStore.getState();
  let changed = false;
  const restoredClips = clips.map((clip) => {
    const saved = snapshot.transforms.get(clip.id);
    if (!saved || (JSON.stringify(saved.position) === JSON.stringify(clip.transform.position)
      && JSON.stringify(saved.scale) === JSON.stringify(clip.transform.scale))) return clip;
    changed = true;
    return { ...clip, transform: { ...clip.transform, position: { ...saved.position }, scale: { ...saved.scale } } };
  });
  const restoredKeyframes = new Map<string, Keyframe[]>();
  clipKeyframes.forEach((keys: Keyframe[], clipId: string) => {
    restoredKeyframes.set(clipId, keys.map((key) => {
      const value = snapshot.keyframeValues.get(key.id);
      if (value === undefined || Object.is(value, key.value)) return key;
      changed = true;
      return { ...key, value };
    }));
  });
  if (changed) useTimelineStore.setState({ clips: restoredClips, clipKeyframes: restoredKeyframes });
}

/** The canvas at `size`, reached from the snapshot in one resize with `layout`. */
export function applyPhoneFormat(snapshot: PhoneFormatSnapshot, size: PhoneFormatSize, layout: CompositionResizeLayout): void {
  restorePhoneFormatSnapshot(snapshot);
  if (!sameSize(size, snapshot.size)) {
    useMediaStore.getState().updateComposition(snapshot.compId, { width: size.width, height: size.height }, { resizeLayout: layout });
  }
}
