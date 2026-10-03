import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { createClipSpeedSource, resolveClipSourceTime, videoFrameSourceTime } from '../../services/timeline/retime/clipRetime';
import { isVideoInspectorSectionEnabled } from '../../services/videoInspector/sectionBypass';
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
  sourceHold?: boolean;
  timeRemap?: TimelineClip['timeRemap'];
  naturalDuration?: number;
  reversed?: boolean;
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
    sourceMap: clip.transitionSourceMap, sourceOverride: clip.transitionSourceTimeOverride,
    timeRemap: clip.timeRemap, naturalDuration: clip.source.naturalDuration,
    sourceHold: clip.transitionSourceHold, reversed: clip.reversed };
}

export function temporalSourceTime(source: TemporalClipSource, localTime: number): number {
  const held = Math.max(0, Math.min(source.duration, localTime));
  const timing = {
    timeRemap: source.timeRemap, source: { type: 'video' as const, naturalDuration: source.naturalDuration },
    inPoint: source.inPoint, outPoint: source.outPoint, speed: source.speed,
    reversed: source.reversed, transitionSourceMap: source.sourceMap,
    transitionSourceTimeOverride: source.sourceOverride, transitionSourceHold: source.sourceHold,
  };
  // Temporal local time is already in the Slit Scan clock domain.
  return videoFrameSourceTime(resolveClipSourceTime(timing, held, createClipSpeedSource(timing, source.speedKeyframes)));
}
