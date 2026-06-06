import type { ClipAudioState } from '../types/audio';

export interface TimelineWaveformPresenceInput {
  waveform?: readonly number[];
  waveformChannels?: readonly (readonly number[])[];
  audioState?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'> | null;
}

export function hasLegacyWaveformSamples(input: TimelineWaveformPresenceInput): boolean {
  return (input.waveform?.length ?? 0) > 0 ||
    input.waveformChannels?.some(channel => channel.length > 0) === true;
}

export function getPreferredWaveformPyramidRef(input: TimelineWaveformPresenceInput): string | undefined {
  return input.audioState?.processedAnalysisRefs?.processedWaveformPyramidId ??
    input.audioState?.processedAnalysisRefs?.waveformPyramidId ??
    input.audioState?.sourceAnalysisRefs?.waveformPyramidId;
}

export function hasTimelineWaveformData(input: TimelineWaveformPresenceInput): boolean {
  return hasLegacyWaveformSamples(input) || Boolean(getPreferredWaveformPyramidRef(input));
}
