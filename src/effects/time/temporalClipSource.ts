import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { calculateSourceTime, getSpeedAtTime } from '../../utils/speedIntegration';
import { isVideoInspectorSectionEnabled } from '../../services/videoInspector/sectionBypass';
import { resolveTransitionSourceMapTime } from '../../services/timeline/transitionSourceMap';
import { slitScanDurationFactor, slitScanPlaybackFactor } from './slit-scan/timeFactor';

/** Value-only frame context, copied by layer builders; never a decoder or store reference. */
export interface TemporalClipSource {
  mediaId: string;
  localTime: number;
  /** Source-clock advancement per output second, independent of authored clip speed. */
  clockRate?: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  speedKeyframes: Keyframe[];
  sourceMap?: TimelineClip['transitionSourceMap'];
  sourceOverride?: number;
}

export function temporalClipSource(clip: TimelineClip, localTime: number, keyframes: readonly Keyframe[]): TemporalClipSource | undefined {
  if (clip.isComposition || clip.source?.type !== 'video') return undefined;
  const mediaId = clip.source.mediaFileId ?? clip.mediaFileId;
  if (!mediaId) return undefined;
  const speedEnabled = isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange');
  const clockRate = slitScanPlaybackFactor(clip, keyframes, localTime);
  return { mediaId, localTime: localTime * clockRate, clockRate,
    duration: clip.duration * slitScanDurationFactor(clip), inPoint: clip.inPoint, outPoint: clip.outPoint,
    speed: speedEnabled ? clip.speed ?? 1 : 1,
    speedKeyframes: speedEnabled ? keyframes.filter(keyframe => keyframe.property === 'speed').map(keyframe => ({ ...keyframe })) : [],
    sourceMap: clip.transitionSourceMap, sourceOverride: clip.transitionSourceTimeOverride };
}

export function temporalSourceTime(source: TemporalClipSource, localTime: number): number {
  const held = Math.max(0, Math.min(source.duration, localTime));
  const mapped = resolveTransitionSourceMapTime(source.sourceMap, held);
  if (mapped) return mapped.sourceTime;
  if (Number.isFinite(source.sourceOverride)) return source.sourceOverride!;
  const initialSpeed = getSpeedAtTime(source.speedKeyframes, 0, source.speed);
  const start = initialSpeed >= 0 ? source.inPoint : source.outPoint;
  return Math.max(source.inPoint, Math.min(source.outPoint,
    start + calculateSourceTime(source.speedKeyframes, held, source.speed)));
}
