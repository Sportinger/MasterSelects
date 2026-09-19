import { describe, expect, it } from 'vitest';

import { resolveExternalDropReplaceTarget } from '../../src/components/timeline/utils/externalDropReplaceTarget';
import type { ExternalDragPayload } from '../../src/components/timeline/utils/externalDragSession';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const videoTrack: TimelineTrack = {
  id: 'video-track',
  name: 'Video',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

const videoPayload: ExternalDragPayload = {
  kind: 'media-file',
  id: 'replacement-media',
  isAudio: false,
  isVideo: true,
  mediaType: 'video',
};

const clips = [
  {
    id: 'target-clip',
    trackId: videoTrack.id,
    startTime: 4,
    duration: 6,
    source: { type: 'video' },
  } as TimelineClip,
];

describe('resolveExternalDropReplaceTarget', () => {
  it('finds the video clip under the Shift-drop time', () => {
    expect(resolveExternalDropReplaceTarget({
      clips,
      payload: videoPayload,
      targetTrack: videoTrack,
      time: 7,
    })?.id).toBe('target-clip');
  });

  it('rejects the clip end boundary, images, and locked tracks', () => {
    expect(resolveExternalDropReplaceTarget({
      clips,
      payload: videoPayload,
      targetTrack: videoTrack,
      time: 10,
    })).toBeUndefined();
    expect(resolveExternalDropReplaceTarget({
      clips,
      payload: { ...videoPayload, mediaType: 'image' },
      targetTrack: videoTrack,
      time: 7,
    })).toBeUndefined();
    expect(resolveExternalDropReplaceTarget({
      clips,
      payload: videoPayload,
      targetTrack: { ...videoTrack, locked: true },
      time: 7,
    })).toBeUndefined();
  });
});
