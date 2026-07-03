import type { TimelineClip } from '../../types';
import {
  getLazyTimelineAudioElementForClip,
  getLazyTimelineVideoElementForClip,
} from '../timeline/lazyMediaElements';

type ClipSource = NonNullable<TimelineClip['source']>;

export interface AudioSyncMediaResolution {
  sourceType?: ClipSource['type'];
  mediaFileId?: string;
  naturalDuration?: number;
  htmlAudioElement: HTMLAudioElement | null;
  htmlVideoElement: HTMLVideoElement | null;
}

export function resolveAudioSyncMedia(clip: TimelineClip): AudioSyncMediaResolution {
  const source = clip.source;
  const htmlAudioElement = getLazyTimelineAudioElementForClip(clip) ?? null;
  const htmlVideoElement = getLazyTimelineVideoElementForClip(clip) ?? null;

  return {
    sourceType: source?.type,
    mediaFileId: source?.mediaFileId,
    naturalDuration: source?.naturalDuration,
    htmlAudioElement,
    htmlVideoElement,
  };
}
