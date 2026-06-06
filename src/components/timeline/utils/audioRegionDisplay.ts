import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { ClipAudioEditOperation } from '../../../types';
import { getAudioRegionEffectLabel } from '../../../services/audio/audioRegionEffectOperation';

export const AUDIO_REGION_TIMELINE_EPSILON = 0.001;
export const AUDIO_REGION_GAIN_MIN_DB = -24;
export const AUDIO_REGION_GAIN_MAX_DB = 24;
export const AUDIO_REGION_GAIN_SILENCE_DB = -120;
export const AUDIO_REGION_GAIN_SILENCE_THRESHOLD_DB = -96;
export const AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT = 2;
export const AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS = 0.035;

type ModifierEvent = Pick<MouseEvent, 'ctrlKey' | 'metaKey'>;

type AudioRegionTimelineClip = Pick<
  TimelineAudioRegionSelection,
  'startTime' | 'endTime' | 'sourceInPoint' | 'sourceOutPoint'
> & {
  duration: number;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
};

export const AUDIO_REGION_FX_PRESETS: Array<{
  key: string;
  label: string;
  descriptorId: string;
  params: ClipAudioEditOperation['params'];
}> = [
  {
    key: 'fx-high-pass',
    label: 'High Pass',
    descriptorId: 'audio-high-pass',
    params: { frequencyHz: 80, q: 0.707 },
  },
  {
    key: 'fx-low-pass',
    label: 'Low Pass',
    descriptorId: 'audio-low-pass',
    params: { frequencyHz: 8000, q: 0.707 },
  },
  {
    key: 'fx-presence',
    label: 'Presence Boost',
    descriptorId: 'audio-parametric-eq',
    params: { frequencyHz: 3200, gainDb: 3, q: 1.15 },
  },
  {
    key: 'fx-compressor',
    label: 'Compressor',
    descriptorId: 'audio-compressor',
    params: { thresholdDb: -18, ratio: 3, kneeDb: 6, attackMs: 8, releaseMs: 120, makeupGainDb: 0 },
  },
  {
    key: 'fx-de-esser',
    label: 'De-esser',
    descriptorId: 'audio-de-esser',
    params: { frequencyHz: 6500, thresholdDb: -24, ratio: 4, kneeDb: 6, attackMs: 1, releaseMs: 90, makeupGainDb: 0 },
  },
  {
    key: 'fx-noise-gate',
    label: 'Noise Gate',
    descriptorId: 'audio-noise-gate',
    params: { thresholdDb: -48, floorDb: -80, attackMs: 4, releaseMs: 120 },
  },
  {
    key: 'fx-saturation',
    label: 'Saturation',
    descriptorId: 'audio-saturation',
    params: { driveDb: 6, toneHz: 12000, mix: 0.35 },
  },
];

export function isAudioRegionModifierPressed(event: ModifierEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

export function isVideoBakeRegionModifierPressed(event: ModifierEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

export function isAudioRegionSilenceGainDb(gainDb: number): boolean {
  return gainDb <= AUDIO_REGION_GAIN_SILENCE_THRESHOLD_DB;
}

export function sourceTimeToAudioRegionTimelineTime(
  clip: Pick<AudioRegionTimelineClip, 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed'>,
  sourceTime: number,
): number {
  const clipDuration = Math.max(AUDIO_REGION_TIMELINE_EPSILON, clip.duration);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart, clip.outPoint ?? sourceStart + clipDuration);
  const sourceSpan = Math.max(AUDIO_REGION_TIMELINE_EPSILON, sourceEnd - sourceStart);
  const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / sourceSpan));
  const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
  return clip.startTime + timelineRatio * clipDuration;
}

export function resolveAudioRegionTimelineRangeForClip(
  clip: Pick<AudioRegionTimelineClip, 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed'>,
  selection: TimelineAudioRegionSelection,
): { start: number; end: number; duration: number } | null {
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, clip.duration);
  let start = Math.min(selection.startTime, selection.endTime);
  let end = Math.max(selection.startTime, selection.endTime);
  const overlapsClip = end > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
    start < clipEnd - AUDIO_REGION_TIMELINE_EPSILON;

  if (!overlapsClip) {
    const sourceStart = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const sourceEnd = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    start = Math.min(
      sourceTimeToAudioRegionTimelineTime(clip, sourceStart),
      sourceTimeToAudioRegionTimelineTime(clip, sourceEnd),
    );
    end = Math.max(
      sourceTimeToAudioRegionTimelineTime(clip, sourceStart),
      sourceTimeToAudioRegionTimelineTime(clip, sourceEnd),
    );
  }

  const clampedStart = Math.max(clipStart, Math.min(clipEnd, start));
  const clampedEnd = Math.max(clampedStart, Math.min(clipEnd, end));
  const duration = clampedEnd - clampedStart;
  return duration > AUDIO_REGION_TIMELINE_EPSILON
    ? { start: clampedStart, end: clampedEnd, duration }
    : null;
}

export function formatAudioRegionGainLabel(gainDb: number): string {
  if (isAudioRegionSilenceGainDb(gainDb)) return '-\u221e dB';
  return `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
}

export function getInlineAudioEditLabel(type: string, params: Record<string, unknown> | undefined): string {
  if (typeof params?.label === 'string' && params.label.trim().length > 0) {
    return params.label.trim();
  }

  switch (type) {
    case 'gain':
      return typeof params?.gainDb === 'number' ? formatAudioRegionGainLabel(params.gainDb) : 'Gain';
    case 'silence':
    case 'cut':
      return 'Silence';
    case 'insert-silence':
      return 'Insert silence';
    case 'delete-silence':
      return 'Delete silence';
    case 'reverse':
      return 'Reverse';
    case 'invert-polarity':
      return 'Invert polarity';
    case 'swap-channels':
      return 'Swap L/R';
    case 'mono-sum':
      return 'Mono sum';
    case 'split-stereo':
      return params?.sourceChannel === 1 ? 'Right to mono' : 'Left to mono';
    case 'paste':
      return 'Paste';
    case 'repair':
      return 'Repair';
    case 'effect':
      return getAudioRegionEffectLabel({
        type: 'effect',
        params: (params ?? {}) as ClipAudioEditOperation['params'],
      });
    case 'room-tone-fill':
      return 'Room tone';
    case 'spectral-mask':
      return 'Spectral mask';
    case 'spectral-resynthesis':
      return 'Resynthesis';
    default:
      return type;
  }
}

export function clampAudioRegionGainDb(value: number): number {
  return Math.max(AUDIO_REGION_GAIN_SILENCE_DB, Math.min(AUDIO_REGION_GAIN_MAX_DB, value));
}

export function audioRegionGainDbToYPercent(gainDb: number): number {
  const clamped = clampAudioRegionGainDb(gainDb);
  if (clamped <= AUDIO_REGION_GAIN_MIN_DB) {
    const silenceRange = AUDIO_REGION_GAIN_MIN_DB - AUDIO_REGION_GAIN_SILENCE_DB;
    const silenceProgress = silenceRange > 0
      ? (AUDIO_REGION_GAIN_MIN_DB - clamped) / silenceRange
      : 1;
    return 100 - AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT +
      Math.max(0, Math.min(1, silenceProgress)) * AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT;
  }

  const audibleRangePercent = 100 - AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT;
  const normalized = (clamped - AUDIO_REGION_GAIN_MIN_DB) /
    (AUDIO_REGION_GAIN_MAX_DB - AUDIO_REGION_GAIN_MIN_DB);
  return (1 - normalized) * audibleRangePercent;
}

export function audioRegionGainDbFromClientY(clientY: number, rect: Pick<DOMRect, 'top' | 'height'>): number {
  const yPercent = Math.max(0, Math.min(100, ((clientY - rect.top) / Math.max(1, rect.height)) * 100));
  const audibleRangePercent = 100 - AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT;
  if (yPercent >= audibleRangePercent) {
    const bottomProgress = Math.max(
      0,
      Math.min(1, (yPercent - audibleRangePercent) / AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT),
    );
    if (bottomProgress >= 0.995) return AUDIO_REGION_GAIN_SILENCE_DB;
    const minGain = 10 ** (AUDIO_REGION_GAIN_MIN_DB / 20);
    const silenceGain = 10 ** (AUDIO_REGION_GAIN_SILENCE_DB / 20);
    const gain = minGain * ((silenceGain / minGain) ** bottomProgress);
    return clampAudioRegionGainDb(20 * Math.log10(Math.max(silenceGain, gain)));
  }

  const normalized = 1 - (yPercent / audibleRangePercent);
  return clampAudioRegionGainDb(
    AUDIO_REGION_GAIN_MIN_DB + normalized * (AUDIO_REGION_GAIN_MAX_DB - AUDIO_REGION_GAIN_MIN_DB),
  );
}
