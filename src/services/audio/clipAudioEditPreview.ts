import type {
  ClipAudioEditOperation,
  ClipAudioRegionGainPreview,
  TimelineClip,
} from '../../types';

const AUDIO_REGION_GAIN_MIN_DB = -120;
const AUDIO_REGION_GAIN_MAX_DB = 24;
const AUDIO_REGION_GAIN_SILENCE_THRESHOLD_DB = -96;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampRegionGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(AUDIO_REGION_GAIN_MIN_DB, Math.min(AUDIO_REGION_GAIN_MAX_DB, value));
}

function dbToLinearGain(db: number): number {
  if (db <= AUDIO_REGION_GAIN_SILENCE_THRESHOLD_DB) return 0;
  return Math.pow(10, db / 20);
}

function normalizedRange(start: number, end: number): { start: number; end: number } {
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

export function isSourceTimeInAudioEditOperation(
  operation: Pick<ClipAudioEditOperation, 'timeRange'>,
  sourceTime: number,
): boolean {
  if (!operation.timeRange) return false;
  const range = normalizedRange(operation.timeRange.start, operation.timeRange.end);
  return sourceTime >= range.start && sourceTime <= range.end;
}

export function doesRegionGainPreviewMatchOperation(
  preview: ClipAudioRegionGainPreview | null | undefined,
  operation: ClipAudioEditOperation,
): boolean {
  if (!preview || operation.type !== 'gain' || !operation.timeRange) return false;
  const previewRange = normalizedRange(preview.sourceInPoint, preview.sourceOutPoint);
  const operationRange = normalizedRange(operation.timeRange.start, operation.timeRange.end);
  return Math.abs(previewRange.start - operationRange.start) <= 0.001 &&
    Math.abs(previewRange.end - operationRange.end) <= 0.001;
}

export function getRegionGainEnvelopeMultiplier(
  sourceTime: number,
  rangeStart: number,
  rangeEnd: number,
  gainDb: number,
  fadeInSeconds?: number,
  fadeOutSeconds?: number,
): number {
  const range = normalizedRange(rangeStart, rangeEnd);
  if (sourceTime < range.start || sourceTime > range.end) return 1;

  const duration = Math.max(0.001, range.end - range.start);
  const localTime = Math.max(0, Math.min(duration, sourceTime - range.start));
  const fadeIn = Math.max(0, finiteNumber(fadeInSeconds, 0));
  const fadeOut = Math.max(0, finiteNumber(fadeOutSeconds, 0));
  const fadeInEnvelope = fadeIn > 0 ? Math.min(1, localTime / fadeIn) : 1;
  const fadeOutEnvelope = fadeOut > 0 ? Math.min(1, (duration - localTime) / fadeOut) : 1;
  const envelope = Math.max(0, Math.min(1, Math.min(fadeInEnvelope, fadeOutEnvelope)));
  const targetGain = dbToLinearGain(clampRegionGainDb(gainDb));
  return 1 + (targetGain - 1) * envelope;
}

export function getAudioEditOperationPreviewVolumeMultiplier(
  operation: ClipAudioEditOperation,
  sourceTime: number,
  channelIndex?: number,
): number {
  if (operation.enabled === false || !isSourceTimeInAudioEditOperation(operation, sourceTime)) {
    return 1;
  }
  if (channelIndex !== undefined && operation.channelMask?.length && !operation.channelMask.includes(channelIndex)) {
    return 1;
  }

  switch (operation.type) {
    case 'gain':
      return operation.timeRange
        ? getRegionGainEnvelopeMultiplier(
            sourceTime,
            operation.timeRange.start,
            operation.timeRange.end,
            finiteNumber(operation.params.gainDb, 0),
            finiteNumber(operation.params.fadeInSeconds, 0),
            finiteNumber(operation.params.fadeOutSeconds, 0),
          )
        : 1;
    case 'silence':
    case 'cut':
      return 0;
    case 'delete-silence':
      return operation.params.compactTimeline === true ? 1 : 0;
    default:
      return 1;
  }
}

export function getRegionGainPreviewVolumeMultiplier(
  preview: ClipAudioRegionGainPreview | null | undefined,
  clipId: string,
  sourceTime: number,
): number {
  if (!preview || preview.clipId !== clipId) return 1;
  return getRegionGainEnvelopeMultiplier(
    sourceTime,
    preview.sourceInPoint,
    preview.sourceOutPoint,
    preview.gainDb,
    preview.fadeInSeconds,
    preview.fadeOutSeconds,
  );
}

export function getClipAudioEditPreviewVolumeMultiplier(
  clip: TimelineClip,
  sourceTime: number,
  regionGainPreview?: ClipAudioRegionGainPreview | null,
): number {
  let multiplier = 1;
  for (const operation of clip.audioState?.editStack ?? []) {
    if (doesRegionGainPreviewMatchOperation(regionGainPreview, operation)) continue;
    multiplier *= getAudioEditOperationPreviewVolumeMultiplier(operation, sourceTime);
    if (multiplier <= 0) return 0;
  }
  multiplier *= getRegionGainPreviewVolumeMultiplier(regionGainPreview, clip.id, sourceTime);
  return Math.max(0, Math.min(4, multiplier));
}
