// Store writes of the phone shape path editor, through the same timeline actions the desktop
// Motion shape tab uses: addMotionShapeClip for a new path, updateMotionLayer for the points and
// the closed flag (MotionPathPointsEditor), setPropertyValue for trim and dash (keyframe-aware
// NumberRow paths shape.path.trim.* / shape.path.dash.*). Every write sets absolute state.

import { useTimelineStore } from '../../../stores/timeline';
import {
  createColorFillAppearance, createDefaultPathShape, createStrokeAppearance,
  type MotionLayerDefinition, type MotionPathVertex, type PathShapeDefinition,
} from '../../../types/motionDesign';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { TimelineClip } from '../../../types/timeline';
import { getPhoneActiveCompSize } from '../crop/phoneClipTarget';

export type PhoneShapePathTarget =
  | { kind: 'path'; clip: TimelineClip; path: PathShapeDefinition }
  /** A motion shape that is not a path yet (rectangle, ellipse, …): the sheet can turn it into one. */
  | { kind: 'shape'; clip: TimelineClip }
  /** Nothing usable selected; `trackId` is where a new path would go (or null with the reason). */
  | { kind: 'none'; trackId: string | null; reason: string };

export type PhonePathNumberKey = 'trim.start' | 'trim.end' | 'trim.offset' | 'dash.length' | 'dash.gap' | 'dash.offset';

function selectedClip(): TimelineClip | undefined {
  const state = useTimelineStore.getState();
  const id = state.primarySelectedClipId && state.selectedClipIds.has(state.primarySelectedClipId)
    ? state.primarySelectedClipId
    : [...state.selectedClipIds][0];
  return id ? state.clips.find((clip) => clip.id === id) : undefined;
}

export function resolvePhoneShapePathTarget(): PhoneShapePathTarget {
  const state = useTimelineStore.getState();
  const clip = selectedClip();
  if (clip?.source?.type === 'motion-shape' && clip.motion?.kind === 'shape' && clip.motion.shape) {
    const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
    if (track?.locked) return { kind: 'none', trackId: null, reason: 'The shape sits on a locked track. Unlock the track first.' };
    if (clip.motion.shape.primitive === 'path' && clip.motion.shape.path) return { kind: 'path', clip, path: clip.motion.shape.path };
    return { kind: 'shape', clip };
  }
  const video = state.tracks.find((track) => track.type === 'video' && !track.locked);
  return video
    ? { kind: 'none', trackId: video.id, reason: 'Draw a new path, or select a shape clip to edit its path.' }
    : { kind: 'none', trackId: null, reason: 'A path needs an unlocked video track. Add one under Tracks first.' };
}

const PATH_DURATION = 5;

/**
 * The track a new path goes on: the top video track when it is unlocked and free for the path's five
 * seconds (so the line draws over the picture), else a new video track on top (addTrack puts video
 * tracks above the others). Never on a track where it would hide another clip.
 */
function pathTrack(start: number): string {
  const state = useTimelineStore.getState();
  const top = state.tracks.find((track) => track.type === 'video');
  const busy = top ? state.clips.some((clip) => clip.trackId === top.id && clip.startTime < start + PATH_DURATION && clip.startTime + clip.duration > start) : true;
  if (top && !top.locked && !busy) return top.id;
  return state.addTrack('video');
}

/** Creates a path clip at the playhead above the picture: a stroke, no fill, five seconds. Returns its id. */
export function createPhonePathClip(): string {
  const state = useTimelineStore.getState();
  const comp = getPhoneActiveCompSize();
  const trackId = pathTrack(state.playheadPosition);
  const id = useTimelineStore.getState().addMotionShapeClip(trackId, state.playheadPosition, {
    duration: PATH_DURATION,
    primitive: 'path', name: 'Path', size: { w: comp.width / 2, h: comp.height / 2 },
  });
  if (!id) throw new Error('The editor could not add a path on this track.');
  useTimelineStore.getState().updateMotionLayer(id, (motion) => withPathLook(motion));
  useTimelineStore.getState().selectClip?.(id);
  return id;
}

/** A drawn line: visible stroke, hidden fill (shapes made on the desktop keep their own look). */
function withPathLook(motion: MotionLayerDefinition): MotionLayerDefinition {
  const items = (motion.appearance?.items ?? []).map((item) => (item.kind === 'color-fill' ? { ...item, visible: false } : item));
  if (!items.some((item) => item.kind === 'color-fill')) items.push({ ...createColorFillAppearance(), visible: false });
  if (!items.some((item) => item.kind === 'stroke')) items.push({ ...createStrokeAppearance({ r: 1, g: 1, b: 1, a: 1 }), visible: true, width: 12 });
  return { ...motion, appearance: { version: 1, items } };
}

/** Turns a rectangle, ellipse, polygon or star into a path primitive (the desktop's primitive switch). */
export function convertPhoneShapeToPath(clipId: string): void {
  useTimelineStore.getState().updateMotionLayer(clipId, (current) => (current.shape
    ? {
        ...current,
        shape: {
          ...current.shape, primitive: 'path', cornerRadius: undefined, polygon: undefined, star: undefined,
          path: current.shape.path ?? createDefaultPathShape(current.shape.size),
        },
      }
    : current));
}

/** Writes the path's vertices and closed flag (trim and dash stay as they are). */
export function writePhonePath(clipId: string, vertices: readonly MotionPathVertex[], closed: boolean): void {
  const store = useTimelineStore.getState();
  if (!store.clips.some((clip) => clip.id === clipId)) throw new Error('The shape clip no longer exists.');
  store.updateMotionLayer(clipId, (current) => (current.shape?.primitive === 'path'
    ? { ...current, shape: { ...current.shape, path: { ...(current.shape.path ?? createDefaultPathShape(current.shape.size)), vertices: vertices.map((v) => ({ ...v })), closed } } }
    : current));
}

/** Trim and dash values, keyframe-aware like the desktop NumberRow (a keyframe lands at the playhead when animated). */
export function writePhonePathNumber(clipId: string, key: PhonePathNumberKey, value: number): void {
  useTimelineStore.getState().setPropertyValue(clipId, `shape.path.${key}` as AnimatableProperty, value);
}

export function readPhonePathNumber(path: PathShapeDefinition | undefined, key: PhonePathNumberKey): number {
  switch (key) {
    case 'trim.start': return path?.trim?.start ?? 0;
    case 'trim.end': return path?.trim?.end ?? 1;
    case 'trim.offset': return path?.trim?.offset ?? 0;
    case 'dash.length': return path?.dash?.length ?? 0;
    case 'dash.gap': return path?.dash?.gap ?? 0;
    case 'dash.offset': return path?.dash?.offset ?? 0;
  }
}
