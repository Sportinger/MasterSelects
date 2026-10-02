import { getCachedTimelineWaveformArtifact } from '../../../services/timeline/timelineWaveformArtifactWarmup';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { ClipAudioState } from '../../../types/audio';
import { getPreferredWaveformPyramidRef } from '../../../utils/audioWaveformPresence';
import {
  buildWaveformLod,
  normalizeWaveformColumnsForDisplay,
  resolveWaveformDisplayReferencePeak,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
} from './waveformLod';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

const MAX_RENDERED_WAVEFORM_CHANNELS = 2;

type PreparedWaveform = NonNullable<TimelineClipCanvasWorkerPreparedClipResources['waveform']>;
// Numeric source data survives fresh paint projections and source-ref enrichment.
// Keep only a few display/trim variants; workers clone columns before transfer.
const MAX_PREPARED_VARIANTS = 8;
const preparedWaveforms = new WeakMap<object, Array<{
  dependencies: readonly unknown[];
  resource: PreparedWaveform;
}>>();

export type TimelineClipCanvasWaveformPyramidMap = ReadonlyMap<string, TimelineWaveformPyramid | null>;

export interface TimelineClipCanvasWaveformResourceClipInput {
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

export function getTimelineClipCanvasWaveformPyramidForClip(
  clip: TimelineClipCanvasWaveformResourceClipInput,
  waveformPyramids: TimelineClipCanvasWaveformPyramidMap | undefined,
): TimelineWaveformPyramid | null {
  const refId = getPreferredWaveformPyramidRef(clip);
  if (!refId) return null;
  return waveformPyramids?.get(refId) ?? getCachedTimelineWaveformArtifact(refId) ?? null;
}

export function resolveTimelineClipCanvasWaveformChannelIndexes(
  pyramid: TimelineWaveformPyramid | null,
  waveformChannels: readonly (readonly number[])[] | undefined,
  height: number,
): number[] {
  const pyramidIndexes = pyramid?.levels
    .find(level => level.channels.length > 0)
    ?.channels.map(channel => channel.channelIndex) ?? [];
  const legacyIndexes = waveformChannels
    ?.map((channel, index) => (channel.length > 0 ? index : -1))
    .filter(index => index >= 0) ?? [];
  const indexes = pyramidIndexes.length > 0
    ? pyramidIndexes
    : legacyIndexes.length > 0
      ? legacyIndexes
      : [0];
  const maxChannels = height < 42 ? 1 : MAX_RENDERED_WAVEFORM_CHANNELS;
  return indexes.slice(0, maxChannels);
}

export function createTimelineClipCanvasWorkerWaveformResource(
  clip: TimelineClipCanvasWaveformResourceClipInput,
  waveformPyramids: TimelineClipCanvasWaveformPyramidMap | undefined,
  mode: TimelineAudioDisplayMode | undefined,
  height: number,
  timeToPixel: (time: number) => number,
  cacheKey?: object,
): TimelineClipCanvasWorkerPreparedClipResources['waveform'] | undefined {
  if (!isTimelineClipCanvasAudioClip(clip) || mode === 'spectral') return undefined;

  const pyramid = getTimelineClipCanvasWaveformPyramidForClip(clip, waveformPyramids);
  const hasLegacyWaveform = (clip.waveform?.length ?? 0) > 0 || (clip.waveformChannels?.some(channel => channel.length > 0) ?? false);
  if (!pyramid && !hasLegacyWaveform) return undefined;

  const absoluteWidth = Math.max(
    1,
    Math.round(timeToPixel(clip.startTime + clip.duration) - timeToPixel(clip.startTime)),
  );
  const width = Math.max(8, Math.min(1024, absoluteWidth));
  const naturalDuration = Math.max(0.001, pyramid?.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const inPoint = Math.max(0, Math.min(naturalDuration, clip.inPoint ?? 0));
  const outPoint = Math.max(inPoint + 0.001, Math.min(naturalDuration, clip.outPoint ?? inPoint + clip.duration));
  const workerMode = mode === 'compact' ? 'compact' : 'detailed';
  const pixelsPerSecond = Math.max(1, timeToPixel(1) - timeToPixel(0));
  const dependencies = [
    clip.waveform, clip.waveformChannels, pyramid, workerMode, height < 42, width,
    naturalDuration, inPoint, outPoint, pixelsPerSecond,
  ];
  const sourceKey = pyramid ?? clip.waveformChannels ?? clip.waveform ?? cacheKey;
  const variants = sourceKey ? preparedWaveforms.get(sourceKey) : undefined;
  const cached = variants?.find(entry => dependencies.every((value, index) => Object.is(value, entry.dependencies[index])));
  if (cached) {
    return cached.resource;
  }
  const channelIndexes = resolveTimelineClipCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, height);
  const channels: number[][] = [];
  let columnCount = 0;
  const columns: number[] = [];

  channelIndexes.forEach((channelIndex) => {
    const lod = buildWaveformLod({
      waveform: clip.waveform ?? [],
      waveformChannels: clip.waveformChannels,
      pyramid,
      width,
      inPoint,
      outPoint,
      naturalDuration,
      pixelsPerSecond,
      channelIndex,
    });
    if (!lod || lod.columns.length === 0) return;

    const smoothed = smoothWaveformColumns(lod.columns, lod.source === 'pyramid' ? 1 : 2, 0.45);
    const normalized = normalizeWaveformColumnsForDisplay(smoothed, {
      targetPeak: workerMode === 'compact' ? 0.52 : 0.66,
      minReferencePeak: 0.032,
      maxGain: 16,
      referencePeak: resolveWaveformDisplayReferencePeak(smoothed, { minReferencePeak: 0.032 }),
      perceptualScale: workerMode !== 'compact',
      noiseFloorDb: -30,
    });
    if (normalized.length === 0) return;
    if (columnCount > 0 && normalized.length !== columnCount) return;

    columnCount = normalized.length;
    const channelColumns: number[] = [];
    normalized.forEach((column) => {
      channelColumns.push(column.min, column.max, column.rms, column.peak);
    });
    channels.push(channelColumns);
  });
  if (channels.length === 0 || columnCount === 0) return undefined;

  channels.forEach((channelColumns) => columns.push(...channelColumns));
  const resource: PreparedWaveform = {
    kind: 'waveform',
    columns,
    columnCount,
    channelCount: channels.length,
    mode: workerMode,
  };
  if (sourceKey) {
    const next = variants ?? [];
    if (next.length >= MAX_PREPARED_VARIANTS) next.shift();
    next.push({ dependencies, resource });
    preparedWaveforms.set(sourceKey, next);
  }
  return resource;
}
