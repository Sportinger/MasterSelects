// Occlusion culling for video tracks.
// A track stacked beneath a clip that provably covers the whole frame with
// opaque pixels contributes nothing to the picture, yet building its layer
// still costs a decode, a texture import and (for nested comps) an offscreen
// render plus a full composite pass. The render-visible set below stops at the
// first track that stays opaque and full-frame for the lookahead window, so
// covered tracks are neither hydrated, played nor composited. The window keeps
// a track alive long enough before it is uncovered for normal warm-up.
//
// Every uncertainty counts as "not opaque": only simple, untouched, centered
// full-frame video (or nested comps whose content qualifies) can occlude.

import type { TimelineClip, TimelineTrack } from '../../types';
import type { FrameContext } from './types';

export const OCCLUSION_LOOKAHEAD_SECONDS = 2;
const MAX_NESTING_DEPTH = 4;
const EPSILON = 1e-4;

type OcclusionContext = Pick<
  FrameContext,
  'clips' | 'videoTracks' | 'visibleVideoTrackIds' | 'playheadPosition' | 'isPlaying' | 'playbackSpeed'
  | 'mediaFileById' | 'compositionById' | 'hasKeyframes'
>;

interface FrameSize {
  width: number;
  height: number;
}

let cullingDisabled = false;

/** Debug switch (also reachable as `window.__msOcclusionCulling = false`). */
export function setOcclusionCullingEnabled(enabled: boolean): void {
  cullingDisabled = !enabled;
}

function occlusionCullingEnabled(): boolean {
  const override = (globalThis as { __msOcclusionCulling?: boolean }).__msOcclusionCulling;
  return override !== false && !cullingDisabled;
}

function nearly(value: number | undefined, expected: number): boolean {
  return Math.abs((value ?? expected) - expected) < EPSILON;
}

/** Centered, unrotated, normal-blend, fully opaque and large enough to fill the frame. */
function transformCoversFrame(clip: TimelineClip, source: FrameSize, frame: FrameSize): boolean {
  const t = clip.transform;
  if (!t) return false;
  if (!nearly(t.opacity, 1) || (t.blendMode && t.blendMode !== 'normal')) return false;
  if (!nearly(t.position?.x, 0) || !nearly(t.position?.y, 0) || !nearly(t.position?.z, 0)) return false;
  if (!nearly(t.anchor?.x, 0) || !nearly(t.anchor?.y, 0)) return false;
  if (!nearly(t.rotation?.x, 0) || !nearly(t.rotation?.y, 0) || !nearly(t.rotation?.z, 0)) return false;
  if (t.scale?.all !== undefined && !nearly(t.scale.all, 1)) return false;
  const scaleX = t.scale?.x ?? 1;
  const scaleY = t.scale?.y ?? 1;
  return source.width * scaleX >= frame.width - 0.5 && source.height * scaleY >= frame.height - 0.5;
}

/** Nothing on the clip may introduce transparency or move pixels over time. */
function clipIsUntouched(ctx: OcclusionContext, clip: TimelineClip): boolean {
  if (clip.is3D || clip.sourceRect || clip.transitionIn || clip.transitionOut) return false;
  if (clip.masks?.length) return false;
  if (clip.effects?.some((effect) => effect.enabled !== false)) return false;
  return !ctx.hasKeyframes(clip.id);
}

function videoSourceIsOpaque(ctx: OcclusionContext, clip: TimelineClip): FrameSize | null {
  if (clip.source?.type !== 'video') return null;
  const mediaFileId = clip.source.mediaFileId ?? clip.mediaFileId;
  const media = mediaFileId ? ctx.mediaFileById.get(mediaFileId) : undefined;
  if (!media?.width || !media.height) return null;
  if (media.canBeTransparent !== false) return null;
  return { width: media.width, height: media.height };
}

function clipAt(clips: readonly TimelineClip[], trackId: string, time: number): TimelineClip | null {
  let found: TimelineClip | null = null;
  for (const clip of clips) {
    if (clip.trackId !== trackId) continue;
    if (time + 1e-6 >= clip.startTime && time < clip.startTime + clip.duration) {
      // On a shared cut boundary prefer the incoming (later) clip, as the layer builder does.
      if (!found || clip.startTime > found.startTime) found = clip;
    }
  }
  return found;
}

/** True when one clip covers the frame opaquely for its local time range [from, to]. */
function clipOccludes(
  ctx: OcclusionContext,
  clip: TimelineClip,
  from: number,
  to: number,
  frame: FrameSize,
  depth: number,
): boolean {
  if (!clipIsUntouched(ctx, clip)) return false;

  if (clip.isComposition) {
    if (depth >= MAX_NESTING_DEPTH || !clip.compositionId || !clip.nestedClips || !clip.nestedTracks) return false;
    if (clip.reversed || !nearly(clip.speed, 1) || ctx.hasKeyframes(clip.id, 'speed')) return false;
    const composition = ctx.compositionById.get(clip.compositionId);
    if (!composition?.width || !composition.height) return false;
    if (!transformCoversFrame(clip, composition, frame)) return false;
    const toLocal = (time: number) => time - clip.startTime + clip.inPoint;
    const nestedTracks = clip.nestedTracks.filter((track) => track.type === 'video' && track.visible !== false);
    return rangeIsCovered(ctx, clip.nestedClips, nestedTracks, toLocal(from), toLocal(to),
      { width: composition.width, height: composition.height }, depth + 1);
  }

  const source = videoSourceIsOpaque(ctx, clip);
  return source !== null && transformCoversFrame(clip, source, frame);
}

/**
 * True when, at every instant of [from, to], some track (checked top to bottom)
 * shows an occluding clip. Sequential clips hand the coverage over at their cuts.
 */
function rangeIsCovered(
  ctx: OcclusionContext,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  from: number,
  to: number,
  frame: FrameSize,
  depth: number,
): boolean {
  let time = from;
  for (let guard = 0; guard < 64; guard += 1) {
    let coveredUntil: number | null = null;
    for (const track of tracks) {
      const clip = clipAt(clips, track.id, time);
      if (!clip) continue;
      const clipEnd = clip.startTime + clip.duration;
      if (!clipOccludes(ctx, clip, time, Math.min(to, clipEnd), frame, depth)) return false;
      coveredUntil = clipEnd;
      break;
    }
    if (coveredUntil === null) return false;
    if (coveredUntil >= to - 1e-6) return true;
    time = coveredUntil;
  }
  return false;
}

/** Does this track alone hide everything beneath it over [from, to]? */
function trackOccludes(
  ctx: OcclusionContext,
  track: TimelineTrack,
  from: number,
  to: number,
  frame: FrameSize,
): boolean {
  return rangeIsCovered(ctx, ctx.clips, [track], from, to, frame, 0);
}

/**
 * Visible video tracks that can contribute pixels now or within the lookahead
 * window; tracks beneath a lasting full-frame opaque track are dropped.
 */
export function computeRenderVisibleVideoTrackIds(ctx: OcclusionContext, frame: FrameSize | null): Set<string> {
  const visible = ctx.visibleVideoTrackIds;
  if (!frame || !occlusionCullingEnabled()) return visible;

  const direction = ctx.isPlaying && ctx.playbackSpeed < 0 ? -1 : 1;
  const reach = OCCLUSION_LOOKAHEAD_SECONDS * Math.max(1, Math.abs(ctx.isPlaying ? ctx.playbackSpeed : 1));
  const from = direction > 0 ? ctx.playheadPosition : ctx.playheadPosition - reach;
  const to = direction > 0 ? ctx.playheadPosition + reach : ctx.playheadPosition;

  const result = new Set<string>();
  for (const track of ctx.videoTracks) {
    if (!visible.has(track.id)) continue;
    result.add(track.id);
    if (trackOccludes(ctx, track, from, to, frame)) break;
  }
  return result;
}
