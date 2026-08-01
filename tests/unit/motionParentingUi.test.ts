import { describe, expect, it } from 'vitest';
import { evaluateMotionParentDrop } from '../../src/components/timeline/utils/motionParentingUi';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const tracks = [
  { id: 'video-a', type: 'video', locked: false },
  { id: 'video-b', type: 'video', locked: false },
  { id: 'audio-a', type: 'audio', locked: false },
] as TimelineTrack[];

const clip = (id: string, overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id,
  trackId: 'video-a',
  name: id,
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  ...overrides,
} as TimelineClip);

describe('motion parenting UI validation', () => {
  it('accepts an unlocked 2D video parent', () => {
    const result = evaluateMotionParentDrop({
      sourceClipId: 'child',
      targetClipId: 'parent',
      clips: [clip('child'), clip('parent', { trackId: 'video-b' })],
      tracks,
    });

    expect(result.status).toBe('valid');
  });

  it.each([
    ['self parenting', [clip('child')], 'child', 'cannot parent itself'],
    ['a cycle', [clip('child'), clip('parent', { parentClipId: 'child' })], 'parent', 'create a cycle'],
    ['a mixed 3D edge', [clip('child', { is3D: true }), clip('parent')], 'parent', '2D-to-2D'],
    ['a non-video edge', [clip('child'), clip('audio', { trackId: 'audio-a' })], 'audio', 'video-layer clips'],
  ])('blocks %s with a diagnostic', (_label, clips, targetClipId, diagnostic) => {
    const result = evaluateMotionParentDrop({
      sourceClipId: 'child',
      targetClipId,
      clips: clips as TimelineClip[],
      tracks,
    });

    expect(result.status).toBe('blocked');
    expect(result.diagnostic).toContain(diagnostic);
  });

  it('blocks locked child and target tracks', () => {
    const clips = [clip('child'), clip('parent', { trackId: 'video-b' })];
    expect(evaluateMotionParentDrop({
      sourceClipId: 'child',
      targetClipId: 'parent',
      clips,
      tracks: tracks.map((track) => track.id === 'video-a' ? { ...track, locked: true } : track),
    }).diagnostic).toContain('child track');
    expect(evaluateMotionParentDrop({
      sourceClipId: 'child',
      targetClipId: 'parent',
      clips,
      tracks: tracks.map((track) => track.id === 'video-b' ? { ...track, locked: true } : track),
    }).diagnostic).toContain('target track');
  });
});
