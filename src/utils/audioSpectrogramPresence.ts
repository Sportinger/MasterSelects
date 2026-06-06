import type { ClipAudioState } from '../types/audio';

export interface TimelineSpectrogramPresenceInput {
  audioState?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'> | null;
}

export function getPreferredSpectrogramTileSetRef(
  input: TimelineSpectrogramPresenceInput,
): string | undefined {
  return input.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0] ??
    input.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
}

export function hasTimelineSpectrogramData(input: TimelineSpectrogramPresenceInput): boolean {
  return Boolean(getPreferredSpectrogramTileSetRef(input));
}
