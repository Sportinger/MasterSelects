import type {
  TimelineSpectralRegionSelection,
} from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types';
import { resolveTimelineAudioRegionSelection } from './audioEditSelection';

export interface TimelineSpectralSelectionInput {
  clip: Pick<TimelineClip, 'id' | 'trackId' | 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed' | 'waveform'>;
  anchorTimelineTime: number;
  focusTimelineTime: number;
  anchorFrequencyHz: number;
  focusFrequencyHz: number;
  maxFrequencyHz: number;
}

export interface TimelineSpectralBrushSelectionInput {
  clip: TimelineSpectralSelectionInput['clip'];
  centerTimelineTime: number;
  centerFrequencyHz: number;
  timeRadiusSeconds: number;
  frequencyRadiusHz: number;
  maxFrequencyHz: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function getSpectralMaxFrequencyHz(sampleRate: number | undefined, fallback = 24_000): number {
  return Math.max(1, Number.isFinite(sampleRate) && sampleRate ? sampleRate / 2 : fallback);
}

export function frequencyHzFromSpectralY(y: number, height: number, maxFrequencyHz: number): number {
  const normalizedY = clamp(y / Math.max(1, height), 0, 1);
  const highToLow = 1 - normalizedY;
  return clamp(Math.pow(highToLow, 2.15) * maxFrequencyHz, 0, maxFrequencyHz);
}

export function spectralYFromFrequencyHz(frequencyHz: number, height: number, maxFrequencyHz: number): number {
  const normalizedFrequency = clamp(frequencyHz / Math.max(1, maxFrequencyHz), 0, 1);
  const highToLow = Math.pow(normalizedFrequency, 1 / 2.15);
  return clamp((1 - highToLow) * Math.max(1, height), 0, Math.max(1, height));
}

export function resolveTimelineSpectralRegionSelection(
  input: TimelineSpectralSelectionInput,
): TimelineSpectralRegionSelection {
  const timeSelection = resolveTimelineAudioRegionSelection({
    clip: input.clip,
    anchorTimelineTime: input.anchorTimelineTime,
    focusTimelineTime: input.focusTimelineTime,
    snapThresholdSeconds: 0,
  });
  const maxFrequencyHz = Math.max(1, Number.isFinite(input.maxFrequencyHz) ? input.maxFrequencyHz : 24_000);
  const frequencyMinHz = clamp(Math.min(input.anchorFrequencyHz, input.focusFrequencyHz), 0, maxFrequencyHz);
  const frequencyMaxHz = clamp(Math.max(input.anchorFrequencyHz, input.focusFrequencyHz), frequencyMinHz, maxFrequencyHz);

  return {
    ...timeSelection,
    frequencyMinHz,
    frequencyMaxHz,
    selectionMode: 'rectangle',
  };
}

export function resolveTimelineSpectralBrushSelection(
  input: TimelineSpectralBrushSelectionInput,
): TimelineSpectralRegionSelection {
  const maxFrequencyHz = Math.max(1, Number.isFinite(input.maxFrequencyHz) ? input.maxFrequencyHz : 24_000);
  const timeRadiusSeconds = Math.max(0.001, Number.isFinite(input.timeRadiusSeconds) ? input.timeRadiusSeconds : 0.05);
  const frequencyRadiusHz = Math.max(1, Number.isFinite(input.frequencyRadiusHz) ? input.frequencyRadiusHz : maxFrequencyHz * 0.04);
  const frequencyMinHz = clamp(input.centerFrequencyHz - frequencyRadiusHz, 0, maxFrequencyHz);
  const frequencyMaxHz = clamp(input.centerFrequencyHz + frequencyRadiusHz, frequencyMinHz, maxFrequencyHz);
  const selection = resolveTimelineSpectralRegionSelection({
    clip: input.clip,
    anchorTimelineTime: input.centerTimelineTime - timeRadiusSeconds,
    focusTimelineTime: input.centerTimelineTime + timeRadiusSeconds,
    anchorFrequencyHz: frequencyMinHz,
    focusFrequencyHz: frequencyMaxHz,
    maxFrequencyHz,
  });

  return {
    ...selection,
    selectionMode: 'brush',
    brushTimeRadiusSeconds: timeRadiusSeconds,
    brushFrequencyRadiusHz: frequencyRadiusHz,
  };
}
