import {
  getPreferredWaveformPyramidRef,
  hasLegacyWaveformSamples,
  type TimelineWaveformPresenceInput,
} from '../../../utils/audioWaveformPresence';
import { getPreferredSpectrogramTileSetRef } from '../../../utils/audioSpectrogramPresence';

export interface TimelineClipCanvasAudioClipInput extends TimelineWaveformPresenceInput {
  trackType?: 'video' | 'audio' | 'midi';
  source?: {
    type?: string | null;
  } | null;
}

export function hasTimelineClipCanvasAudioAnalysisRef(input: TimelineClipCanvasAudioClipInput): boolean {
  return Boolean(getPreferredWaveformPyramidRef(input) || getPreferredSpectrogramTileSetRef(input));
}

export function isTimelineClipCanvasAudioClip(input: TimelineClipCanvasAudioClipInput): boolean {
  return input.trackType === 'audio' ||
    input.source?.type === 'audio' ||
    hasLegacyWaveformSamples(input) ||
    hasTimelineClipCanvasAudioAnalysisRef(input);
}
