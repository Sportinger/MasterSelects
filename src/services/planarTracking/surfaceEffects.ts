import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { PlanarTrack } from '../../types/planarTracking';
import { calculateSourceTime } from '../../utils/speedIntegration';
import { sampleOcclusion, sampleSurface } from './surfaceGeometry';
import { isVideoInspectorSectionEnabled } from '../videoInspector/sectionBypass';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';
import { terrainEffectForFrame } from './terrainProjection';

export type SurfaceClip = Pick<TimelineClip, 'planarTracks' | 'inPoint' | 'outPoint' | 'speed' | 'reversed' | 'videoInspectorSections' | 'transitionSourceMap' | 'transitionSourceTimeOverride' | 'mediaFileId'> & {
  source?: { mediaFileId?: string } | null;
};

export function surfaceSourceTime(clip: SurfaceClip, localTime: number, keys: readonly Keyframe[] = []): number {
  const mapped = resolveTransitionSourceMapTime(clip.transitionSourceMap, localTime);
  if (mapped) return mapped.sourceTime;
  if (Number.isFinite(clip.transitionSourceTimeOverride)) return clip.transitionSourceTimeOverride!;
  const enabled = isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange');
  const speed = enabled ? clip.speed ?? (clip.reversed ? -1 : 1) : 1;
  return Math.max(clip.inPoint, Math.min(clip.outPoint,
    (speed >= 0 ? clip.inPoint : clip.outPoint) + calculateSourceTime(enabled ? [...keys] : [], localTime, speed)));
}

/** Both preview and export consume these ordinary GPU effects, in source space. */
export function appendSurfaceEffects(effects: Effect[], clip: SurfaceClip, localTime: number, keys: readonly Keyframe[] = []): Effect[] {
  if (!clip.planarTracks?.length) return effects;
  const time = surfaceSourceTime(clip, localTime, keys);
  const overlays: Effect[] = [];
  for (const track of clip.planarTracks) {
    const sourceId = clip.source?.mediaFileId ?? clip.mediaFileId;
    if (sourceId && track.sourceId !== sourceId) continue;
    if (!track.enabled) continue;
    // Retain the binding even outside requested coverage: a held texture may
    // still belong to a covered frame. The compositor resolves against its PTS.
    overlays.push({ ...(surfaceEffectForFrame(track, time) ?? {
      id: `surface:${track.id}`, type: 'surface-overlay', name: track.name, enabled: true, params: { opacity: 0 },
    }), surfaceTrack: track });
  }
  return [...effects, ...overlays];
}

export function surfaceEffectForFrame(track: PlanarTrack, presentedTime: number): Effect | null {
    if(track.projection==='mesh')return terrainEffectForFrame(track,presentedTime);
    const sample = sampleSurface(track, presentedTime);
    if (!sample || !track.enabled || sample.time < track.visibleFrom || sample.time > track.visibleTo) return null;
    const time = sample.time;
    const fade = track.fade > 0 ? Math.min(1, (time-track.visibleFrom)/track.fade, (track.visibleTo-time)/track.fade) : 1;
    const params: Effect['params'] = { color: track.color, opacity: track.opacity * fade, fill: track.fill,
      lineWidth: track.lineWidth, inset: track.inset, shape: track.shape };
    sample.quad.forEach((p, i) => { params[`x${i}`] = p.x; params[`y${i}`] = p.y; });
    const occlusion = sampleOcclusion(track, time);
    params.occluded = !!occlusion;
    occlusion?.forEach((p,i) => { params[`ox${i}`] = p.x; params[`oy${i}`] = p.y; });
    return { id: `surface:${track.id}`, type: 'surface-overlay', name: track.name, enabled: true, params };
}

/** Called after texture selection, shared by top-level, nested, and export compositing. */
export function resolveSurfaceFrameEffects(effects: Effect[], presentedTime: number | undefined): Effect[] {
  if (!effects.some(effect => effect.surfaceTrack)) return effects;
  return effects.flatMap(effect => {
    if (!effect.surfaceTrack) return [effect];
    // Unknown frame identity is not evidence that the requested frame is visible.
    if (presentedTime === undefined || !Number.isFinite(presentedTime)) return [];
    const resolved = surfaceEffectForFrame(effect.surfaceTrack, presentedTime);
    return resolved ? [resolved] : [];
  });
}
