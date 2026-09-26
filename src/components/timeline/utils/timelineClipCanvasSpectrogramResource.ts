import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';
import { getCachedTimelineSpectrogramArtifact } from '../../../services/timeline/timelineSpectrogramArtifactWarmup';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { ClipAudioState } from '../../../types/audio';
import {
  resolveTimelineSpectrogramSourceRange,
  type TimelineSpectrogramSourceVariant,
} from './spectrogramCanvas';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export type TimelineClipCanvasSpectrogramTileSetMap = ReadonlyMap<string, TimelineSpectrogramTileSet | null>;

export interface TimelineClipCanvasSpectrogramResourceClipInput {
  trackType?: 'video' | 'audio' | 'midi' | 'score';
  startTime: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  waveform?: readonly number[];
  waveformChannels?: readonly (readonly number[])[];
  audioState?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'> | null;
  source?: {
    type?: string | null;
    naturalDuration?: number;
  } | null;
}

export function getTimelineClipCanvasSpectrogramTileSetForClip(
  clip: TimelineClipCanvasSpectrogramResourceClipInput,
  spectrogramTileSets: TimelineClipCanvasSpectrogramTileSetMap | undefined,
): {
  refId: string | undefined;
  tileSet: TimelineSpectrogramTileSet | null;
  variant: TimelineSpectrogramSourceVariant;
} {
  const processedRefId = clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0];
  const sourceRefId = clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
  const refId = processedRefId ?? sourceRefId;
  const variant: TimelineSpectrogramSourceVariant = processedRefId ? 'processed' : 'source';
  if (!refId) return { refId, tileSet: null, variant };
  return {
    refId,
    variant,
    tileSet: spectrogramTileSets?.get(refId) ?? getCachedTimelineSpectrogramArtifact(refId) ?? null,
  };
}

export function createTimelineClipCanvasWorkerSpectrogramResource(
  clip: TimelineClipCanvasSpectrogramResourceClipInput,
  spectrogramTileSets: TimelineClipCanvasSpectrogramTileSetMap | undefined,
  mode: TimelineAudioDisplayMode | undefined,
  height: number,
  timeToPixel: (time: number) => number,
): TimelineClipCanvasWorkerPreparedClipResources['spectrogram'] | undefined {
  if (!isTimelineClipCanvasAudioClip(clip) || mode !== 'spectral') return undefined;
  const { refId, tileSet, variant } = getTimelineClipCanvasSpectrogramTileSetForClip(clip, spectrogramTileSets);
  const channel = tileSet?.channels[0];
  if (!refId || !tileSet || !channel) return undefined;

  const absoluteWidth = Math.max(
    1,
    Math.round(timeToPixel(clip.startTime + clip.duration) - timeToPixel(clip.startTime)),
  );
  const rasterWidth = Math.max(8, Math.min(768, absoluteWidth));
  const rasterHeight = Math.max(8, Math.min(96, Math.round(height - 2)));
  const spectrogramDuration = Math.max(0.001, tileSet.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const sourceRange = resolveTimelineSpectrogramSourceRange({
    variant,
    visibleSourceInPoint: clip.inPoint ?? 0,
    visibleSourceOutPoint: clip.outPoint ?? (clip.inPoint ?? 0) + clip.duration,
    tileDuration: spectrogramDuration,
    visibleStartRatio: 0,
    visibleEndRatio: 1,
  });
  const sourceSpan = Math.max(0.000001, sourceRange.outPoint - sourceRange.inPoint);
  const secondsPerFrame = tileSet.hopSize / Math.max(1, tileSet.sampleRate);
  const values: number[] = [];

  for (let y = 0; y < rasterHeight; y += 1) {
    const highToLow = 1 - (y / Math.max(1, rasterHeight - 1));
    const perceptual = Math.pow(Math.max(0, Math.min(1, highToLow)), 2.15);
    const binIndex = Math.max(0, Math.min(
      tileSet.frequencyBinCount - 1,
      Math.round(perceptual * (tileSet.frequencyBinCount - 1)),
    ));
    for (let x = 0; x < rasterWidth; x += 1) {
      const timeMix = rasterWidth <= 1 ? 0 : x / (rasterWidth - 1);
      const sourceTime = Math.max(0, Math.min(
        spectrogramDuration,
        sourceRange.inPoint + sourceSpan * timeMix,
      ));
      const frameIndex = tileSet.frameCount <= 1
        ? 0
        : Math.max(0, Math.min(
          tileSet.frameCount - 1,
          Math.round(sourceTime / Math.max(0.000001, secondsPerFrame)),
        ));
      values.push(channel.values[frameIndex * tileSet.frequencyBinCount + binIndex] ?? 0);
    }
  }

  return {
    kind: 'spectrogram',
    values,
    rasterWidth,
    rasterHeight,
  };
}
