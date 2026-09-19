import { describe, expect, it } from 'vitest';

import { resolveExternalDropCompositionReplaceTarget } from '../../src/components/timeline/utils/externalDropCompositionReplaceTarget';
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

const compositionPayload: ExternalDragPayload = {
  kind: 'composition',
  id: 'replacement-composition',
  isAudio: false,
  isVideo: true,
  mediaType: 'composition',
};

const clips = [{
  id: 'target-clip',
  trackId: videoTrack.id,
  startTime: 4,
  duration: 6,
  source: { type: 'video' },
} as TimelineClip];

describe('resolveExternalDropCompositionReplaceTarget', () => {
  it('finds a visual clip under a Shift-dropped composition', () => {
    expect(resolveExternalDropCompositionReplaceTarget({
      clips,
      payload: compositionPayload,
      targetTrack: videoTrack,
      time: 7,
    })?.id).toBe('target-clip');
  });

  it('rejects media payloads, locked tracks, and the clip end boundary', () => {
    expect(resolveExternalDropCompositionReplaceTarget({
      clips,
      payload: { ...compositionPayload, kind: 'media-file' },
      targetTrack: videoTrack,
      time: 7,
    })).toBeUndefined();
    expect(resolveExternalDropCompositionReplaceTarget({
      clips,
      payload: compositionPayload,
      targetTrack: { ...videoTrack, locked: true },
      time: 7,
    })).toBeUndefined();
    expect(resolveExternalDropCompositionReplaceTarget({
      clips,
      payload: compositionPayload,
      targetTrack: videoTrack,
      time: 10,
    })).toBeUndefined();
  });
});
