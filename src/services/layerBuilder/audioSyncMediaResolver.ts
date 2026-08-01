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
  // Lazy-media records own ordinary timeline media, but generated composition
  // mixdowns are attached directly to the clip source. Falling back to those
  // runtime handles is essential: otherwise every audio-sync pass concludes
  // that the mixdown is missing, creates a replacement element, and tears down
  // the element that was just made the playback master.
  const htmlAudioElement = getLazyTimelineAudioElementForClip(clip)
    ?? source?.audioElement
    ?? null;
  const htmlVideoElement = getLazyTimelineVideoElementForClip(clip)
    ?? source?.videoElement
    ?? null;

  return {
    sourceType: source?.type,
    mediaFileId: source?.mediaFileId,
    naturalDuration: source?.naturalDuration,
    htmlAudioElement,
    htmlVideoElement,
  };
}
