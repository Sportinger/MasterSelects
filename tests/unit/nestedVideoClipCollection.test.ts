import { describe, expect, it } from 'vitest';
import { collectNestedVideoClips } from '../../src/engine/export/clipPreparation/nestedVideoClips';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';

function track(id: string, type: TimelineTrack['type']): TimelineTrack {
  return {
    id,
    name: id,
    type,
    visible: true,
    muted: false,
    solo: false,
  } as TimelineTrack;
}

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    trackId: 'video',
    name: 'clip',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    ...overrides,
  } as TimelineClip;
}

describe('collectNestedVideoClips', () => {
  it('does not traverse the linked audio representation of a nested composition', () => {
    const visualLeaf = clip({ id: 'visual-leaf', name: 'stripe.mp4' });
    const duplicatedAudioLeaf = clip({ id: 'audio-twin-leaf', name: 'stripe.mp4' });
    const visualComposition = clip({
      id: 'nested-visual',
      isComposition: true,
      compositionId: 'child-comp',
      trackId: 'nested-video',
      nestedTracks: [track('child-video', 'video')],
      nestedClips: [{ ...visualLeaf, trackId: 'child-video' }],
    });
    const audioComposition = clip({
      id: 'nested-audio',
      name: 'Nested Comp (Audio)',
      isComposition: true,
      compositionId: 'child-comp',
      trackId: 'nested-audio',
      source: { type: 'audio' },
      nestedTracks: [track('child-video-copy', 'video')],
      nestedClips: [{ ...duplicatedAudioLeaf, trackId: 'child-video-copy' }],
    });
    const root = clip({
      id: 'root-comp',
      isComposition: true,
      compositionId: 'root',
      nestedTracks: [track('nested-video', 'video'), track('nested-audio', 'audio')],
      nestedClips: [visualComposition, audioComposition],
    });

    expect(collectNestedVideoClips(root).map((entry) => entry.clip.id)).toEqual([
      'visual-leaf',
    ]);
  });
});
