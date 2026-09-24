import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { ClipMask, MaskVertex } from '../../types/masks';
import { createMaskPathProperty } from '../../types/animationProperties';
import { useTimelineStore } from '../../stores/timeline';
import { useHistoryStore } from '../../stores/historyStore';
import { useMediaStore } from '../../stores/mediaStore';
import { surfaceSourceTime } from '../planarTracking/surfaceEffects';
import { sampleRotoMask } from './rotoPreviewProjection';
import { rotoMaskVertices } from './rotoContour';
import type { RotoMask } from './rotoTypes';
import type { RotoEdges } from './rotoEdges';

export function bakeRotoClipMask(clip: TimelineClip, frames: RotoMask[], edges: RotoEdges, fps: number, sourceKeys: Keyframe[], id: string) {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error('Invalid clip timing.');
  const count = Math.ceil(clip.duration * fps);
  if (count > 18000) throw new Error('Trim the clip to 18,000 output frames or fewer before converting to a mask.');
  const empty: MaskVertex[] = Array.from({ length: 3 }, (_, i) => ({ id: `${id}:${i}`, x: -1, y: -1,
    handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' }));
  const paths = new Map<RotoMask, MaskVertex[]>(), keys: Keyframe[] = [];
  let previous: RotoMask | undefined, budget = 0, covered = false;
  for (let i = 0; i < count; i++) {
    const time = i / fps, sample = sampleRotoMask(frames, surfaceSourceTime(clip, time, sourceKeys));
    if (i && previous === sample) continue;
    previous = sample;
    if (sample && !paths.has(sample)) paths.set(sample, rotoMaskVertices(sample, edges, id));
    const vertices = sample ? paths.get(sample)! : empty;
    covered ||= !!sample;
    budget += vertices.length;
    if (budget > 300000) throw new Error('This selection produces too many mask vertices. Convert a shorter clip or export the mask video.');
    keys.push({ id: crypto.randomUUID(), clipId: clip.id, time, property: createMaskPathProperty(id), value: 0,
      easing: 'linear', hold: true, pathValue: { closed: true, vertices } });
  }
  if (!covered) throw new Error('No tracked frames are visible in this clip.');
  // Edge softness is re-expressed using the editor's editable feather control.
  const mask: ClipMask = { id, name: 'Roto mask', vertices: keys[0].pathValue!.vertices, closed: true,
    opacity: 1, feather: edges.softness, featherQuality: 50, inverted: false, mode: 'intersect', expanded: true,
    position: { x: 0, y: 0 }, enabled: true, visible: true, compositeEnabled: true };
  return { mask, keys };
}

export function createRotoClipMask(clipId: string, compositionId: string | null, frames: RotoMask[], edges: RotoEdges) {
  const timeline = useTimelineStore.getState(), media = useMediaStore.getState();
  const clip = timeline.clips.find(c => c.id === clipId);
  if (!clip || compositionId !== media.activeCompositionId || timeline.isExporting || timeline.tracks.find(t => t.id === clip.trackId)?.locked)
    throw new Error('The clip is locked or unavailable.');
  const fps = media.compositions.find(c => c.id === compositionId)?.frameRate ?? 30;
  const { mask, keys } = bakeRotoClipMask(clip, frames, edges, fps, timeline.getClipKeyframes(clipId), crypto.randomUUID());
  const history = useHistoryStore.getState(), batch = history.startBatch('Convert Roto to clip mask');
  try {
    timeline.updateClip(clipId, { masks: [...(clip.masks ?? []), mask] });
    useTimelineStore.setState(state => {
      const clipKeyframes = new Map(state.clipKeyframes);
      clipKeyframes.set(clipId, [...(clipKeyframes.get(clipId) ?? []), ...keys].toSorted((a, b) => a.time - b.time));
      return { clipKeyframes };
    });
    useTimelineStore.getState().invalidateCache();
    return mask.id;
  } finally { if (batch.opened) history.endBatch(); }
}
