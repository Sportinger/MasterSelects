import {
  getPreferredWaveformPyramidRef,
  type TimelineWaveformPresenceInput,
} from '../../../utils/audioWaveformPresence';
import { getPreferredSpectrogramTileSetRef } from '../../../utils/audioSpectrogramPresence';

export interface TimelineClipCanvasAudioClipInput extends TimelineWaveformPresenceInput {
  trackType?: 'video' | 'audio' | 'midi' | 'score';
  source?: {
    type?: string | null;
  } | null;
}

export function hasTimelineClipCanvasAudioAnalysisRef(input: TimelineClipCanvasAudioClipInput): boolean {
  return Boolean(getPreferredWaveformPyramidRef(input) || getPreferredSpectrogramTileSetRef(input));
}

export function isTimelineClipCanvasAudioClip(input: TimelineClipCanvasAudioClipInput): boolean {
  if (input.trackType) return input.trackType === 'audio';
  return input.source?.type === 'audio';
}
