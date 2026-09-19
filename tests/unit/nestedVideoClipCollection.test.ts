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

  it('intersects every parent trim with the export range without changing source timing', () => {
    const leaf = clip({ id: 'retained', startTime: 40, duration: 2, inPoint: 8, outPoint: 12, speed: 2 });
    const child = clip({
      id: 'child', isComposition: true, startTime: 12, duration: 4, inPoint: 40, outPoint: 44,
      nestedTracks: [track('video', 'video')],
      nestedClips: [leaf, clip({ id: 'outside-child-trim', startTime: 46 })],
    });
    const root = clip({
      id: 'root', isComposition: true, startTime: 20, duration: 10, inPoint: 10, outPoint: 20,
      nestedTracks: [track('video', 'video')],
      nestedClips: [child, clip({ id: 'outside-export', startTime: 18 })],
    });
    const found = collectNestedVideoClips(root, { startTime: 22.5, endTime: 23.5 });
    expect(found.map(entry => entry.clip.id)).toEqual(['retained']);
    expect(found[0].clip).toBe(leaf);
    expect(found[0].mainTimelineStart).toBe(22);
    expect(found[0].mainTimelineDuration).toBe(2);
    expect(leaf).toMatchObject({ inPoint: 8, outPoint: 12, speed: 2 });
  });

  it.each([
    { speed: 2 },
    { speed: -1 },
    { reversed: true },
    { transitionSourceMap: { version: 1, segments: [{ kind: 'hold', compStart: 0, compEnd: 5, sourceTime: 100 }] } },
    { transitionIn: { id: 'transition', type: 'crossfade', duration: 1, linkedClipId: 'previous' } },
  ] satisfies Partial<TimelineClip>[])(
    'conservatively retains descendants of retimed or transition compositions: %j', (timing) => {
      const root = clip({
        id: 'root', isComposition: true, nestedTracks: [track('video', 'video')],
        nestedClips: [clip({ id: 'mapped-leaf', startTime: 100 })], ...timing,
      });
      expect(collectNestedVideoClips(root, { startTime: 1, endTime: 2 }).map(entry => entry.clip.id))
        .toEqual(['mapped-leaf']);
    },
  );

  it('retains animated-speed descendants using the captured keyframes', () => {
    const root = clip({
      id: 'animated-root', isComposition: true, nestedTracks: [track('video', 'video')],
      nestedClips: [clip({ id: 'speed-ramp-leaf', startTime: 100 })],
    });
    expect(collectNestedVideoClips(root, {
      startTime: 1, endTime: 2, hasAnimatedSpeed: candidate => candidate.id === root.id,
    }).map(entry => entry.clip.id)).toEqual(['speed-ramp-leaf']);
  });

  it('keeps a shared frame boundary after sub-nanosecond source rounding', () => {
    const split = 83 / 30;
    const root = clip({
      isComposition: true, nestedTracks: [track('video', 'video')],
      nestedClips: [clip({ id: 'before', duration: split - 1e-12 }), clip({ id: 'after', startTime: split + 1e-12 })],
    });
    expect(collectNestedVideoClips(root, { startTime: split, endTime: split + 1 / 30 })
      .map(entry => entry.clip.id)).toEqual(['before', 'after']);
  });

  it.each([false, true])('retains an outgoing-only transition partner (composition=%s)', (isComposition) => {
    const incoming = clip({
      id: 'incoming', startTime: 5, duration: 5, isComposition,
      ...(isComposition ? {
        nestedTracks: [track('video', 'video')],
        nestedClips: [clip({ id: 'incoming-leaf', startTime: 0 })],
      } : {}),
    });
    const outgoing = clip({
      id: 'outgoing', duration: 5,
      transitionOut: { id: 'out-only', type: 'crossfade', duration: 2, linkedClipId: incoming.id },
    });
    const root = clip({
      id: 'root', isComposition: true, duration: 10,
      nestedTracks: [track('video', 'video')], nestedClips: [outgoing, incoming],
    });
    expect(incoming.transitionIn).toBeUndefined();
    expect(collectNestedVideoClips(root, { startTime: 4.25, endTime: 4.75 }).map(entry => entry.clip.id))
      .toEqual(['outgoing', isComposition ? 'incoming-leaf' : 'incoming']);
  });
});
