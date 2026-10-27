// The picture the Effects and Filters cards preview on, chosen once when the sheet opens: the
// composition's current frame (it shows the selected clip when the clip is under the playhead), or the
// neutral sample frame when no visible video clip covers the playhead. The id is new on every open, so
// the desktop thumbnail runtime (lookThumbnailRuntime) captures the frame as it is now; it stays fixed
// while the sheet is open, so cards do not re-render each time a tap adds an effect live.

import { useState } from 'react';

import { lookThumbnailRuntime } from '../../../effects/looks/lookThumbnailRuntime';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { createPhoneSampleFrame } from './phoneSampleFrame';

export interface PhonePreviewSource {
  /** Source id for lookThumbnailRuntime.renderLook. */
  id: string;
  /** 'frame': the composition at the playhead; 'sample': the neutral sample picture. */
  kind: 'frame' | 'sample';
}

/** Pure: whether a visible video track has a clip under `time`. */
export function hasPictureAt(clips: readonly TimelineClip[], tracks: readonly TimelineTrack[], time: number): boolean {
  const visibleVideo = new Set(tracks.filter((track) => track.type === 'video' && track.visible !== false).map((track) => track.id));
  return clips.some((clip) => visibleVideo.has(clip.trackId) && clip.startTime <= time && time < clip.startTime + clip.duration);
}

let openCount = 0;

export function usePhonePreviewSource(): PhonePreviewSource {
  const [source] = useState<PhonePreviewSource>(() => {
    const { clips, tracks, playheadPosition } = useTimelineStore.getState();
    const compId = useMediaStore.getState().activeCompositionId ?? 'timeline';
    openCount += 1;
    if (!hasPictureAt(clips, tracks, playheadPosition)) {
      const id = 'phone-sample-frame';
      lookThumbnailRuntime.defineSampleSource(id, createPhoneSampleFrame);
      return { id, kind: 'sample' };
    }
    return { id: `phone:${compId}:${Math.floor(playheadPosition * 30)}:${openCount}`, kind: 'frame' };
  });
  return source;
}
